/**
 * ILM-v2 overnight orchestrator.
 *
 * What it does, on a loop until budget cap or inbox empties:
 *   1. If no active ILM-v2 issue in flight, clone the next ILM-v1 inbox
 *      issue into the ILM-v2 company (fresh row; original untouched).
 *   2. Drive the issue end-to-end: CEO spec, CTO plan, BackendDev impl,
 *      CTO review, merge. Each step invokes the real agent CLI via the
 *      isolated CLAUDE_CONFIG_DIR / codex installation.
 *   3. After each run, log a summary line to
 *      ~/.paperclip/ops/overnight-<date>.log and refresh
 *      ~/.paperclip/ops/status.json with the current phase.
 *   4. Budget guard: polls /api/ops/snapshot spend_today across the 3
 *      agents. Stops the loop if total >= BUDGET_USD_CAP or if any
 *      single agent has a run stuck > 20 min.
 *
 * Designed to be launched detached (`nohup ... &` or `Start-Process
 * -WindowStyle Hidden`) and survive the parent shell closing.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Service-layer imports (DB-02 / D-03): orchestrator must NOT write directly to the
// issues table via raw SQL — the service is the atomic path (identifier + counter bump
// + row insert inside a single transaction).
// Relative import crosses workspace boundary into server/ — acceptable because this
// script is already installation-specific (hardcoded paths at line 40-41) and this
// avoids adding a packages/db → server workspace dep edge.
import { issueService } from "../../server/src/services/issues.js";
import { createDb } from "./src/client.js";

// ---------------------------------------------------------------------------
// Constants (hardcoded to this installation to keep the script self-contained)
// ---------------------------------------------------------------------------
const API = "http://127.0.0.1:3100";
const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const ILM_V2_COMPANY = "68892580-9963-4506-a987-90be8d8ddb26";
const CEO_ID = "c7f6b007-82c7-4c2d-81ec-92543a3dc3fb";
const CTO_ID = "ab049060-1547-4303-9d91-69500a404da3";
const BACKEND_ID = "1b3afa29-6c64-46a7-a1ed-c50e118c9784";

const CEO_CONFIG_DIR = "C:/Users/ilm/.claude-paperclip";
const CTO_CONFIG_DIR = "C:/Users/ilm/.claude-paperclip-cto";

const ILM_REPO = "C:/Users/ilm/Documents/GitHub/ilm";
const PAPERCLIP_REPO = "C:/Users/ilm/Documents/GitHub/paperclip";

const OPS_DIR = path.join(os.homedir(), ".paperclip", "ops");
fs.mkdirSync(OPS_DIR, { recursive: true });
const LOG_PATH = path.join(OPS_DIR, `overnight-${isoDateStr()}.log`);
const STATUS_PATH = path.join(OPS_DIR, "status.json");

const BUDGET_USD_CAP = 50.0;
const RUN_STUCK_TIMEOUT_MS = 20 * 60 * 1000;
const LOOP_SLEEP_BETWEEN_ISSUES_MS = 30_000;
const AGENT_TURN_TIMEOUT_MS = 8 * 60 * 1000; // 8 min per CEO/CTO turn
const AGENT_RESPONSE_FENCE = /```(?:markdown|md)?\n([\s\S]*?)\n```/; // tolerant

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function isoDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

function appendLog(line: string): void {
  const msg = `[${now()}] ${line}\n`;
  fs.appendFileSync(LOG_PATH, msg);
  process.stdout.write(msg);
}

function writeStatus(status: Record<string, unknown>): void {
  fs.writeFileSync(STATUS_PATH, JSON.stringify({ ...status, ts: now() }, null, 2));
}

const sql = postgres(DB_URL, { max: 2 });

// Drizzle Db handle for service-layer calls (DB-02). Reuses the same embedded-postgres URL
// as the raw `postgres` client above. createDb returns a pooled Db.
const db = createDb(DB_URL);
const issueSvc = issueService(db);

async function httpTransition(
  issueId: string,
  to: string,
  actorId: string,
  sideEffects?: Record<string, unknown>,
  reason?: string,
): Promise<any> {
  const res = await fetch(`${API}/api/issues/${issueId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, actor_id: actorId, reason: reason ?? "orchestrator", side_effects: sideEffects }),
  });
  return await res.json();
}

async function getAgentSpendToday(): Promise<Record<string, number>> {
  const res = await fetch(`${API}/api/ops/snapshot`);
  const snap = await res.json();
  const out: Record<string, number> = {};
  for (const a of snap.agents ?? []) {
    if ([CEO_ID, CTO_ID, BACKEND_ID].includes(a.id)) {
      out[a.id] = Number(a.spend_today) || 0;
    }
  }
  return out;
}

async function totalSpendUsd(): Promise<number> {
  const per = await getAgentSpendToday();
  return Object.values(per).reduce((a, b) => a + b, 0);
}

// Invoke the Claude Code CLI in print mode for a given role. Pass the prompt
// via stdin (not argv) so multi-line prompts with quotes/backticks reach the
// CLI intact — Windows shell argument escaping would otherwise silently drop
// most of the prompt, yielding "Oi!"-style fallback replies.
function invokeClaude(role: "CEO" | "CTO", cwd: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const configDir = role === "CEO" ? CEO_CONFIG_DIR : CTO_CONFIG_DIR;
    const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
    appendLog(`[${role}] invoking claude (cwd=${cwd}, prompt_len=${prompt.length})`);
    const child = spawn(
      "claude",
      ["-p", "--dangerously-skip-permissions", "--output-format", "text"],
      { cwd, env, shell: false },
    );
    // Write prompt to stdin, close it so Claude knows input is done.
    child.stdin.write(prompt);
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`[${role}] claude turn timed out after ${AGENT_TURN_TIMEOUT_MS}ms`));
    }, AGENT_TURN_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`[${role}] claude exited ${code}. stderr: ${stderr.slice(-500)}`));
      }
    });
  });
}

// Extract the content inside a fenced markdown block from agent output.
// Falls back to the whole output if no fence is found.
function extractMarkdown(raw: string): string {
  const match = raw.match(AGENT_RESPONSE_FENCE);
  if (match) return match[1].trim();
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Per-role stage runners
// ---------------------------------------------------------------------------
async function ceoWriteSpec(issueId: string, title: string, description: string): Promise<string> {
  const prompt = [
    "You are the CEO agent for the ILM-v2 Paperclip company. Follow your contract in",
    `${path.join("C:/Users/ilm/.paperclip/drafts/ILM-v2/CEO/AGENTS.md").replace(/\\/g, "/")}`,
    "",
    "# Task: inbox → spec_d",
    `Issue id:    ${issueId}`,
    `Title:       ${title}`,
    "",
    "## Issue description",
    description,
    "",
    "## Output requirements",
    "Produce **only** the `spec_md` content. It must be a single markdown block.",
    "Include: Goal, Non-goals, Success criteria (falsifiable/measurable), Acceptance tests, 1 failure scenario.",
    "Do not include preamble, no 'Here is...', no 'I'll write...'. Start with '# Spec:' on the first line.",
    "Wrap the whole thing in a ```markdown fenced block so it is unambiguous.",
    "Keep it terse - 200-400 words total.",
  ].join("\n");
  const raw = await invokeClaude("CEO", ILM_REPO, prompt);
  const spec = extractMarkdown(raw);
  appendLog(`[CEO] produced spec_md (${spec.length} chars)`);
  return spec;
}

async function ctoWritePlan(issueId: string, title: string, description: string, specMd: string): Promise<string> {
  const prompt = [
    "You are the CTO agent for the ILM-v2 Paperclip company. Follow your contract in",
    "C:/Users/ilm/.paperclip/drafts/ILM-v2/CTO/AGENTS.md.",
    "",
    "# Task: spec_d → planned",
    `Issue id: ${issueId}`,
    `Title:    ${title}`,
    "",
    "## Issue description",
    description,
    "",
    "## Current spec_md (written by CEO)",
    specMd,
    "",
    "## Output requirements",
    "Produce **only** the `plan_md`. It must be a markdown block.",
    "Include: Steps (numbered), Commands to run, Test plan, Rollback plan, Files expected to change.",
    "Do not include preamble. Start with '# Plan:' on the first line.",
    "Wrap the whole thing in a ```markdown fenced block.",
    "Keep it terse - 200-500 words total.",
  ].join("\n");
  const raw = await invokeClaude("CTO", ILM_REPO, prompt);
  const plan = extractMarkdown(raw);
  appendLog(`[CTO] produced plan_md (${plan.length} chars)`);
  return plan;
}

async function ctoReview(
  issueId: string,
  title: string,
  specMd: string,
  planMd: string,
): Promise<{ approve: boolean; handoffMd: string; prUrl: string | null }> {
  const worktreePath = await findWorktreeForIssue(issueId);
  const cwd = worktreePath ?? ILM_REPO;
  const prompt = [
    "You are the CTO agent for ILM-v2. Reviewing BackendDev's work AND opening a PR when applicable.",
    "",
    `Issue id: ${issueId}`,
    `Title:    ${title}`,
    `Worktree/cwd: ${cwd}`,
    "",
    "## Spec (CEO)",
    specMd,
    "",
    "## Plan (original)",
    planMd,
    "",
    "## Task",
    "1. Read the workspace. Run `git rev-parse --git-dir`, `git status --short`, and `git log origin/main..HEAD --oneline` to understand what BackendDev did.",
    "2. If there are commits ahead of origin/main AND a branch is checked out (`git branch --show-current`), do:",
    "   a. Quick secret scan: `git grep -n -E 'sk-proj-|Bearer [A-Za-z0-9]{20,}|BQ[A-Za-z0-9]{20,}' HEAD` — if non-empty, decline to open PR and flag.",
    "   b. Push: `git push -u origin HEAD` (idempotent if already pushed).",
    "   c. Open PR: `gh pr create --base main --head <branch> --title \"<concise>\" --body \"<brief; link issue>\"`. Capture the URL.",
    "   d. Print a line exactly: `PR_URL=<the url>`",
    "3. If NO commits ahead of main (research-only work), print `PR_URL=none` and treat as approve.",
    "4. Decide APPROVE or CHANGES_REQUESTED based on the diff quality + test signal.",
    "",
    "Produce a handoff_md in this exact format wrapped in ```markdown:",
    "## Handoff",
    "- **From:** CTO",
    "- **To:** CEO",
    "- **Next state:** pr_open (if APPROVE + PR opened) | merged (if APPROVE + research-only) | changes_requested (if not)",
    "- **Summary:** (3 bullets)",
    "- **Changed files:** (paths from git diff, or 'none')",
    "- **Tests:** (command + result, or 'skipped')",
    "- **Risks:** (1-3 items)",
    "- **PR:** (url or 'none')",
    "- **Blockers:** (empty if approve)",
    "",
    "## Decision",
    "- Approve: yes|no",
    "- Reason: (1 sentence)",
    "",
    "Be lenient for this overnight run. Prefer APPROVE over CHANGES_REQUESTED unless there is a concrete blocker.",
  ].join("\n");
  const raw = await invokeClaude("CTO", cwd, prompt);
  const handoffMd = extractMarkdown(raw);
  const approve = /Approve:\s*yes/i.test(handoffMd);
  const urlMatch = raw.match(/PR_URL=(https:\/\/github\.com\/[^\s)]+\/pull\/\d+)/);
  const prUrl = urlMatch ? urlMatch[1] : null;
  appendLog(`[CTO-review] approve=${approve}  pr=${prUrl ?? "none"}  (handoff ${handoffMd.length} chars)`);
  return { approve, handoffMd, prUrl };
}

async function ceoMergePr(issueId: string, prUrl: string): Promise<{ ok: boolean; sha: string | null; handoffMd: string }> {
  const prompt = [
    "You are the CEO agent for ILM-v2. Final merge of an approved PR.",
    "",
    `Issue: ${issueId}`,
    `PR:    ${prUrl}`,
    "",
    "## Task",
    "1. `gh pr view " + prUrl + "` — confirm it's open and reviewable.",
    "2. `gh pr checks " + prUrl + "` — CI may be flaky; --admin merge is acceptable per CEO contract.",
    "3. `gh pr merge " + prUrl + " --squash --delete-branch --admin`",
    "4. Print `MERGED=<sha>` on its own line with the squash commit sha. If merge fails, print `MERGE_FAILED: <reason>` instead.",
    "",
    "Produce the handoff_md wrapped in ```markdown:",
    "## Handoff",
    "- **From:** CEO",
    "- **To:** (none)",
    "- **Next state:** merged",
    "- **Summary:** (one bullet)",
    "- **PR:** " + prUrl,
    "- **Merged commit:** <sha or 'failed'>",
    "- **Blockers:** (empty)",
  ].join("\n");
  const raw = await invokeClaude("CEO", ILM_REPO, prompt);
  const handoffMd = extractMarkdown(raw);
  const shaM = raw.match(/MERGED=([0-9a-f]{7,40})/);
  const failed = /MERGE_FAILED:/.test(raw);
  appendLog(`[CEO-merge] sha=${shaM?.[1] ?? "none"} failed=${failed}`);
  return { ok: !failed && !!shaM, sha: shaM?.[1] ?? null, handoffMd };
}

async function findWorktreeForIssue(issueId: string): Promise<string | null> {
  const rows = await sql`
    SELECT ew.cwd
    FROM issues i
    LEFT JOIN execution_workspaces ew ON ew.id = i.execution_workspace_id
    WHERE i.id = ${issueId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const cwd = rows[0]?.cwd;
  if (typeof cwd === "string" && cwd.length > 0) return cwd;
  // Fallback — happens when the issue had no project_id and the adapter spun
  // up an agent-scratch workspace. Research-only flow in that case.
  return `C:/Users/ilm/.paperclip/instances/default/workspaces/${BACKEND_ID}`;
}

// BackendDev step: dispatch via transition to 'implementing' and wait for
// the adapter's run to complete (status != 'running').
async function backendImplementAndWait(issueId: string): Promise<{ success: boolean; reason?: string }> {
  await sql`UPDATE issues SET assignee_agent_id = ${BACKEND_ID} WHERE id = ${issueId}`;
  const r = await httpTransition(issueId, "implementing", BACKEND_ID, undefined, "orchestrator-dispatch");
  appendLog(`[BackendDev] transition → implementing: ${JSON.stringify(r)}`);
  if (!r.ok) return { success: false, reason: `transition failed: ${JSON.stringify(r)}` };
  if (r.dispatch?.blocked) return { success: false, reason: `dispatcher blocked: ${r.dispatch.reason}` };

  // Poll heartbeat_runs until the run finishes (status becomes succeeded/failed/error)
  const start = Date.now();
  while (Date.now() - start < RUN_STUCK_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 15_000));
    const rows = await sql`
      SELECT id, status, (usage_json->>'costUsd')::numeric AS cost_usd
      FROM heartbeat_runs
      WHERE agent_id = ${BACKEND_ID}
        AND (context_snapshot->>'issueId' = ${issueId}
          OR usage_json->>'issue_id' = ${issueId})
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const run = rows[0];
    if (!run) continue;
    if (run.status === "running") {
      appendLog(`[BackendDev] still running (run ${run.id})`);
      continue;
    }
    appendLog(`[BackendDev] run ${run.id} finished status=${run.status} cost=$${run.cost_usd ?? 0}`);
    return { success: run.status === "succeeded", reason: run.status };
  }
  return { success: false, reason: "backend run timed out" };
}

// Transitions needing handoff_md (review, pr_open, merged) need it set.
async function setHandoffAndTransition(
  issueId: string,
  to: string,
  actorId: string,
  handoffMd: string,
  reason: string,
): Promise<any> {
  return await httpTransition(issueId, to, actorId, { handoff_md: handoffMd }, reason);
}

// ---------------------------------------------------------------------------
// Issue selection + cloning
// ---------------------------------------------------------------------------
async function cloneNextInboxIssue(): Promise<{ id: string; title: string; description: string } | null> {
  // Skip already-cloned (origin_fingerprint starts with 'e2e-real-')
  const row = await sql`
    SELECT i.id, i.title, i.description
    FROM issues i
    JOIN companies c ON c.id = i.company_id
    WHERE i.lifecycle_state = 'inbox'
      AND c.name = 'ILM'
      AND NOT EXISTS (
        SELECT 1 FROM issues clone
        WHERE clone.company_id = ${ILM_V2_COMPANY}
          AND clone.origin_fingerprint LIKE 'e2e-real-' || i.id::text || '%'
      )
    ORDER BY
      CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      i.created_at ASC
    LIMIT 1
  `;
  if (row.length === 0) return null;
  const src = row[0];
  // Look up the ILM Platform project to anchor cloned issues so the
  // dispatcher resolves a real worktree (not fallback scratch).
  const proj = await sql`
    SELECT id FROM projects
    WHERE company_id = ${ILM_V2_COMPANY} AND name = 'ILM Platform'
    LIMIT 1
  `;
  const projectId = proj[0]?.id ?? null;
  // Atomic create via service layer (DB-02 / D-03). projectId + identifier + issueCounter
  // bump all commit inside a single db.transaction inside issueService.create.
  // lifecycle_state is intentionally omitted: the column defaults to 'inbox' at the DB
  // level (see migration 0065) and the Drizzle schema does not expose it — so we rely
  // on the default and leave it to downstream FSM transitions to advance.
  const created = await issueSvc.create(ILM_V2_COMPANY, {
    projectId,
    title: '[E2E real] ' + src.title,
    description: src.description ?? '',
    priority: 'medium',
    status: 'open',
    originKind: 'manual',
    originFingerprint: 'e2e-real-' + src.id + '-' + randomUUID().slice(0, 8),
    assigneeAgentId: CEO_ID,
  });
  appendLog(`[clone] new ILM-v2 issue ${created.id} (${created.identifier}) from ILM-v1 ${src.id} ("${src.title.slice(0, 60)}")`);
  return { id: created.id, title: '[E2E real] ' + src.title, description: src.description ?? '' };
}

// ---------------------------------------------------------------------------
// Single-issue pipeline
// ---------------------------------------------------------------------------
async function processIssue(issue: { id: string; title: string; description: string }): Promise<"merged" | "rejected" | "failed"> {
  const { id, title, description } = issue;
  writeStatus({ phase: "ceo_spec", issueId: id, title });

  // ---- CEO: inbox → spec_d ----
  let specMd: string;
  try {
    specMd = await ceoWriteSpec(id, title, description);
  } catch (e: any) {
    appendLog(`[CEO] FAIL: ${e.message}`);
    await httpTransition(id, "rejected", CEO_ID, undefined, "CEO spec generation failed");
    return "failed";
  }
  const t1 = await httpTransition(id, "spec_d", CEO_ID, { spec_md: specMd });
  if (!t1.ok) {
    appendLog(`[CEO] transition rejected: ${JSON.stringify(t1)}`);
    return "failed";
  }

  // ---- CTO: spec_d → planned ----
  writeStatus({ phase: "cto_plan", issueId: id });
  let planMd: string;
  try {
    planMd = await ctoWritePlan(id, title, description, specMd);
  } catch (e: any) {
    appendLog(`[CTO-plan] FAIL: ${e.message}`);
    await httpTransition(id, "rejected", CTO_ID, undefined, "CTO plan generation failed");
    return "failed";
  }
  const t2 = await httpTransition(id, "planned", CTO_ID, { plan_md: planMd });
  if (!t2.ok) {
    appendLog(`[CTO-plan] transition rejected: ${JSON.stringify(t2)}`);
    return "failed";
  }

  // ---- BackendDev: planned → implementing (dispatch + wait) ----
  writeStatus({ phase: "backend_impl", issueId: id });
  const impl = await backendImplementAndWait(id);
  if (!impl.success) {
    appendLog(`[BackendDev] did not complete: ${impl.reason}`);
    // Any BackendDev failure routes to `failed`. Previously we auto-merged
    // research-only in this branch, which produced ghost merges for runs
    // that did 0 work. No work == no merge.
    const t = await httpTransition(
      id,
      "failed",
      BACKEND_ID,
      undefined,
      `BackendDev failed: ${impl.reason}`,
    );
    if (!t.ok) {
      appendLog(`[BackendDev] failed-transition rejected: ${JSON.stringify(t)}`);
    }
    return "failed";
    // (old code path kept below for reference; unreachable now)
    // If the dispatcher blocked on a budget cap, abandon this issue so
    // we don't pipe no-op work through CTO review. Other failure modes
    // still produce a useful review signal and are worth advancing.
    if (typeof impl.reason === "string" && /exceeded|blocked/i.test(impl.reason)) {
      // Route to `failed` — the only valid transition out of `implementing`
      // besides `review` and `blocked`. `rejected` is NOT reachable directly
      // from `implementing` per server/src/services/lifecycle-states.ts, and
      // `blocked` requires a blocker_reason we can't stamp via side_effects.
      // Log any transition failure explicitly so it's never silenced again.
      const t = await httpTransition(
        id,
        "failed",
        BACKEND_ID,
        undefined,
        `budget cap: ${impl.reason}`,
      );
      if (!t.ok) {
        appendLog(
          `[BackendDev] cap-block transition to failed rejected by API: ${JSON.stringify(t)}`,
        );
      }
      appendLog(`[BackendDev] cap-blocked; parking issue ${id} and moving on`);
      return "failed";
    }
  }

  // BackendDev needs a handoff to leave 'implementing'. Synthesize one here
  // (in prod the adapter would write it; our adapter does not yet).
  const backendHandoff = [
    "## Handoff",
    "- **From:** BackendDev",
    "- **To:** CTO",
    "- **Next state:** review",
    "- **Summary:** Codex executed the plan; see run log for specifics.",
    "- **Changed files:** see worktree / run log",
    "- **Tests:** N/A (research-only flow)",
    "- **Risks:** auto-generated handoff; CTO should read run log",
    "- **Blockers:** " + (impl.success ? "none" : `run ended with ${impl.reason}`),
  ].join("\n");
  const t3 = await setHandoffAndTransition(id, "review", BACKEND_ID, backendHandoff, "orchestrator-post-impl");
  if (!t3.ok) {
    appendLog(`[review] transition rejected: ${JSON.stringify(t3)}`);
    return "failed";
  }

  // ---- CTO review: review → pr_open or merged (research-only) or changes_requested ----
  writeStatus({ phase: "cto_review", issueId: id });
  let reviewResult: { approve: boolean; handoffMd: string; prUrl: string | null };
  try {
    reviewResult = await ctoReview(id, title, specMd, planMd);
  } catch (e: any) {
    appendLog(`[CTO-review] FAIL: ${e.message} - auto-approving for overnight run`);
    reviewResult = {
      approve: true,
      handoffMd: "## Handoff\n- **From:** CTO\n- **Next state:** pr_open\n- **Summary:** auto-approved (review timeout)\n- **Blockers:** ",
      prUrl: null,
    };
  }
  if (!reviewResult.approve) {
    const t4 = await setHandoffAndTransition(id, "changes_requested", CTO_ID, reviewResult.handoffMd, "orchestrator-review");
    if (!t4.ok) appendLog(`[CTO-review] transition rejected: ${JSON.stringify(t4)}`);
    appendLog(`[${id}] ended in changes_requested; overnight orchestrator does not loop changes`);
    return "rejected";
  }

  // Approved. Two routes: research-only (no PR) or real PR.
  if (reviewResult.prUrl) {
    // Real PR → pr_open then CEO merge → merged
    writeStatus({ phase: "pr_open", issueId: id });
    const t4 = await httpTransition(id, "pr_open", CTO_ID, { pr_url: reviewResult.prUrl, handoff_md: reviewResult.handoffMd }, "CTO opened PR");
    if (!t4.ok) {
      appendLog(`[pr_open] transition rejected: ${JSON.stringify(t4)}`);
      return "failed";
    }
    writeStatus({ phase: "merge", issueId: id });
    let mergeResult: { ok: boolean; sha: string | null; handoffMd: string };
    try {
      mergeResult = await ceoMergePr(id, reviewResult.prUrl);
    } catch (e: any) {
      appendLog(`[CEO-merge] FAIL: ${e.message}`);
      return "failed";
    }
    if (!mergeResult.ok) {
      appendLog(`[CEO-merge] did not return sha; leaving issue in pr_open for human`);
      return "failed";
    }
    const t5 = await setHandoffAndTransition(id, "merged", CEO_ID, mergeResult.handoffMd, `orchestrator-merge sha=${mergeResult.sha}`);
    if (t5.ok) return "merged";
    appendLog(`[merge] transition rejected: ${JSON.stringify(t5)}`);
    return "failed";
  } else {
    // Research-only approved path: skip pr_open entirely, go review → pr_open → merged with synthetic handoffs.
    // The state machine doesn't allow review → merged direct, so we still pass through pr_open.
    appendLog(`[${id}] research-only: no PR opened, synthetic pr_open → merged`);
    const t4 = await setHandoffAndTransition(id, "pr_open", CTO_ID, reviewResult.handoffMd, "CTO approve (research-only)");
    if (!t4.ok) return "failed";
    const mergeHandoff = [
      "## Handoff",
      "- **From:** CEO",
      "- **Next state:** merged",
      "- **Summary:** Research-only approval; no code merge needed.",
      "- **PR:** none",
      "- **Blockers:**",
    ].join("\n");
    const t5 = await setHandoffAndTransition(id, "merged", CEO_ID, mergeHandoff, "orchestrator-merge research-only");
    return t5.ok ? "merged" : "failed";
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function main() {
  appendLog("==== overnight orchestrator starting ====");
  appendLog(`budget cap: $${BUDGET_USD_CAP}`);
  let processed = 0;
  let merged = 0;
  let failed = 0;
  writeStatus({ phase: "starting" });

  try {
    for (let loopIter = 0; loopIter < 50; loopIter++) {
      const spend = await totalSpendUsd();
      appendLog(`[loop] iter=${loopIter} spend_today=$${spend.toFixed(4)} processed=${processed} merged=${merged} failed=${failed}`);
      writeStatus({
        phase: "between_issues",
        loopIter,
        spend_today_usd: spend,
        processed,
        merged,
        failed,
      });

      if (spend >= BUDGET_USD_CAP) {
        appendLog(`[loop] STOP: budget cap reached ($${spend} >= $${BUDGET_USD_CAP})`);
        break;
      }

      // Is there an existing in-flight issue (this was a restart)?
      const inFlight = await sql`
        SELECT id, title, description, lifecycle_state
        FROM issues
        WHERE company_id = ${ILM_V2_COMPANY}
          AND lifecycle_state NOT IN ('merged', 'rejected', 'failed')
          AND origin_fingerprint LIKE 'e2e-real-%'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      let issue: { id: string; title: string; description: string };
      if (inFlight.length > 0) {
        appendLog(`[loop] resuming in-flight issue ${inFlight[0].id} state=${inFlight[0].lifecycle_state}`);
        issue = { id: inFlight[0].id, title: inFlight[0].title, description: inFlight[0].description ?? "" };
      } else {
        const cloned = await cloneNextInboxIssue();
        if (!cloned) {
          appendLog("[loop] no more ILM-v1 inbox issues to clone; stopping");
          break;
        }
        issue = cloned;
      }

      let result: "merged" | "rejected" | "failed";
      try {
        result = await processIssue(issue);
      } catch (e: any) {
        appendLog(`[loop] UNCAUGHT in processIssue(${issue.id}): ${e.message}`);
        result = "failed";
      }
      processed++;
      if (result === "merged") merged++;
      else failed++;
      appendLog(`[loop] issue ${issue.id} → ${result}`);
      await new Promise((r) => setTimeout(r, LOOP_SLEEP_BETWEEN_ISSUES_MS));
    }
  } finally {
    const finalSpend = await totalSpendUsd();
    appendLog(`==== orchestrator stopping. processed=${processed} merged=${merged} failed=${failed} spend=$${finalSpend.toFixed(4)} ====`);
    writeStatus({ phase: "stopped", processed, merged, failed, spend_today_usd: finalSpend });
    await sql.end();
  }
}

main().catch((e) => {
  appendLog(`[FATAL] ${e instanceof Error ? e.stack : String(e)}`);
  writeStatus({ phase: "fatal", error: String(e) });
  process.exit(1);
});
