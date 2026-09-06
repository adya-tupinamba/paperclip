/**
 * Drive the integration issue through the full Paperclip lifecycle
 * using only HTTP transitions (no claude -p orchestration for CEO/CTO).
 * The issue description itself serves as spec_md and plan_md; BackendDev
 * gets the real work via dispatcher wake → adapter → project_workspace.
 */
const API = "http://127.0.0.1:3100";
const ISSUE_ID = "86e7f94b-6ed2-4937-9108-6c987bb0c1f4";
const CEO_ID = "c7f6b007-82c7-4c2d-81ec-92543a3dc3fb";
const CTO_ID = "ab049060-1547-4303-9d91-69500a404da3";
const BACKEND_ID = "1b3afa29-6c64-46a7-a1ed-c50e118c9784";

async function transition(to: string, actorId: string, sideEffects?: Record<string, unknown>, reason?: string) {
  const res = await fetch(`${API}/api/issues/${ISSUE_ID}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, actor_id: actorId, reason: reason ?? "dispatch-integration", side_effects: sideEffects }),
  });
  const body = await res.json();
  console.log(`→ ${to} [HTTP ${res.status}]`, JSON.stringify(body));
  return body;
}

const specMd = `# Spec: integrate overnight Paperclip outputs

## Goal
Apply 37 modified + 25 new files from the ~4-hour overnight autonomous run into the ilm repo on branch \`paperclip/overnight-2026-04-23\`.

## Non-goals
- Opening a PR automatically
- Deploying anything
- Rewriting or curating the overnight content

## Success criteria
- Branch exists on origin
- All 62 files committed with logical grouping
- No secrets leaked
- \`pytest\` + \`pnpm build\` run (noted if fails)

## Acceptance tests
1. \`git ls-remote origin paperclip/overnight-2026-04-23\` returns a sha
2. \`git log --oneline main..paperclip/overnight-2026-04-23\` shows >=3 commits
3. \`git grep -n "sk-proj-\\|Bearer "\` on the branch returns empty
`;

const planMd = `# Plan: sequential apply + split commits

1. \`git worktree add\` the branch from main (Paperclip may have done this already)
2. \`git apply --index ~/.paperclip/ops/overnight-patch/overnight.patch\`
3. \`cp -r <scratch>/ilm/<each-new-file> .\` skipping node_modules/.git
4. Split commits by theme (token redaction, collection health, name matching, CRM, docs, misc)
5. \`git push -u origin paperclip/overnight-2026-04-23\`

## Commands
\`\`\`
git apply --index ~/.paperclip/ops/overnight-patch/overnight.patch
git commit -m "chore(paperclip-overnight): token redaction"
... (repeat per theme)
git push -u origin paperclip/overnight-2026-04-23
\`\`\`

## Test plan
- \`python -m pytest -q\`
- \`cd ilm_crm && pnpm build\`
(Document failures; do not try to fix here — this is integration, not fix-up.)

## Rollback
\`git push origin :paperclip/overnight-2026-04-23\` deletes the remote branch. Local branch harmless.

## Files expected to change
All 62 listed in diff-stat.txt + new-files.txt.
`;

async function main() {
  console.log("=== driving integration issue ===");
  const t1 = await transition("spec_d", CEO_ID, { spec_md: specMd }, "CEO-issue-is-self-spec");
  if (!t1.ok) throw new Error("spec_d failed");

  const t2 = await transition("planned", CTO_ID, { plan_md: planMd }, "CTO-issue-is-self-plan");
  if (!t2.ok) throw new Error("planned failed");

  // Assignee already set to CEO; change to BackendDev before implementing
  // (the orchestrator does this via SQL; we can just pass actor_id=backend)
  const t3 = await transition("implementing", BACKEND_ID, undefined, "dispatch-backend-for-integration");
  if (!t3.ok) throw new Error("implementing failed");

  console.log("\nDispatch result:", JSON.stringify(t3, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
