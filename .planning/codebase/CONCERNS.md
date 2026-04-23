# Codebase Concerns

**Analysis Date:** 2026-04-23

This document catalogs technical debt, active bugs, security considerations, performance bottlenecks, and fragile areas in the Paperclip codebase as observed on the `ilm-v2-reformulation` branch. Eight bugs were surfaced during a live overnight run on 2026-04-23; their reproduction signatures are preserved verbatim from `C:\Users\ilm\.paperclip\instances\default\logs\server.log` where relevant.

---

## Known Bugs (Active, Reproduced 2026-04-23)

### 1. DELETE /api/companies/:id returns 500 (missing cascade on cost_events)

- **Symptoms:** `DELETE /api/companies/f0c2b690-0bad-4421-8043-2f4a328df440` returned HTTP 500 at `2026-04-23T13:14:35`. Postgres raised `PostgresError: update or delete on table "heartbeat_runs" violates foreign key constraint "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" on table "cost_events"` (code 23503). Server log line ~28522.
- **Files:**
  - `packages/db/src/schema/cost_events.ts:18` — `heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id)` has no `onDelete` option, so it defaults to `NO ACTION`.
  - `packages/db/src/schema/heartbeat_runs.ts:38` — conversely has `onDelete: "set null"` for its own FK back-link, confirming the asymmetry is accidental.
  - `server/src/routes/companies.ts` — DELETE handler does not manually nuke `cost_events` before removing `heartbeat_runs`.
- **Trigger:** Any company that has ever had a heartbeat run with an attached cost event (i.e. any real agent run). Reproduced once on f0c2b690 today.
- **Workaround:** Soft delete via `PATCH /api/companies/:id { status: "archived" }` succeeded at `2026-04-23T13:14:51` (server.log line 28548).
- **Fix approach:** Change the FK in `cost_events.ts` to `{ onDelete: "set null" }` (preserves cost history when a run is pruned) OR `{ onDelete: "cascade" }` (matches intent of company deletion). Generate a new drizzle migration in `packages/db/src/migrations/` and apply. Either option fixes hard delete; ALSO extend the DELETE handler in `server/src/routes/companies.ts` to call `db.delete(costEvents).where(eq(costEvents.companyId, id))` explicitly so the schema change is not the sole line of defense.

### 2. Heartbeat worktree literal "$issue_id" shell-expansion failure

- **Symptoms:** Between `2026-04-23T11:44` and `2026-04-23T12:02`, heartbeat runs repeatedly failed with `Configured worktree path "C:\Users\ilm\Documents\GitHub\ilm-worktrees\paperclip\-issue_id" already exists and is not a reusable git worktree (worktree HEAD is on "paperclip/overnight-2026-04-23" instead of "paperclip/-issue_id")`. Server log lines 28362-28449 show 7 consecutive failures with the same literal `$issue_id` token in the path.
- **Files:**
  - `server/src/services/heartbeat.ts:5026` — `executeRun` referenced in stack trace.
  - Worktree path template — most likely `server/src/services/execution-workspaces.ts` or a config field reading a template string like `"C:\...\ilm-worktrees\paperclip\-$issue_id"` without interpolation.
- **Trigger:** Worktree path template was rendered as a raw string (`"...\\-$issue_id"`) instead of being substituted with the real issue id. Node's template literals / JSON config don't do `$var` expansion — the dollar-token was configured expecting shell semantics that never executed.
- **Fix approach:** Audit every call site that builds a worktree path. Replace `$issue_id`/`${issue_id}` tokens in config with a proper template interpolation (e.g. `path.replace("${issueId}", issueId)` or literal `${issueId}` inside a JS template literal, not a JSON string). Add a validator at config load time that rejects any worktree path template still containing an unresolved `$` or `${...}` substring. Grep `executionWorkspacePolicy` configs for users with lingering `$issue_id` tokens and backfill.

### 3. Orchestrator resume loop — `pr_open → spec_d` invalid transition

- **Symptoms:** Issue `7a92c708-8310-4fb0-b961-8578884a0fa6` looped overnight. From `12:36:02` onward the orchestrator issued `POST /api/issues/.../transition` with `{ "to": "spec_d", "actor_id": CEO, "reason": "orchestrator", "side_effects": { "spec_md": "..." } }` and got back HTTP 422 ("responseTime":1-3ms, body 60 bytes) at least 6 times (server.log lines 28509, 28511, 28513, 28515, 28518). Each retry re-invoked Claude Opus to regenerate the spec, burning budget.
- **Files:**
  - `packages/db/orchestrate-e2e.ts:416-578` — `processIssue` has no branch on the issue's current `lifecycle_state` when resuming. Line 620-621 reads `inFlight[0].lifecycle_state` purely for the log line and then calls `processIssue(issue)` which unconditionally starts at CEO spec.
  - `server/src/services/lifecycle-states.ts` (referenced by orchestrate-e2e.ts:475 comment) — correctly rejects `pr_open → spec_d` as a forbidden transition; the 422 is correct behavior.
- **Trigger:** The orchestrator restarted mid-pipeline (issue was at `pr_open` after a previous run), reloaded, and re-entered the state machine from step 1 (`spec_d`) instead of resuming from `pr_open → merged` merge.
- **Fix approach:** In `orchestrate-e2e.ts`, switch on `inFlight[0].lifecycle_state`:
  - `inbox` → start at CEO spec (current behavior).
  - `spec_d` → skip to CTO plan.
  - `planned` → skip to BackendDev impl.
  - `implementing`, `review`, `pr_open`, `changes_requested`, `blocked` → either drive the pipeline forward from that state OR fail-fast with a log and leave the issue for a human.
  - Default / unknown → log and park.
  Add a per-issue retry cap (e.g. 3 failed transitions on the same `from → to` edge in a row → abandon and mark `failed`) to cap blast radius of future state-machine bugs.

### 4. Windows-specific patches in adapters — brittle, untracked in tests

- **Files:**
  - `packages/adapters/codex-local/src/server/codex-home.ts:45-56` — `trySymlink` catches `EPERM`/`ENOSYS` and returns `"failed"`; `ensureSymlink` (line 58-90) falls back to `fs.copyFile`. Happens on Windows NTFS when the user lacks Administrator or Developer Mode. Copy fallback loses auto-sync with the shared codex home.
  - `packages/adapters/pi-local/src/server/execute.ts:342-382` — Windows CreateProcessW ~32k UTF-16 arg-limit workaround. When `renderedSystemPromptExtension.length + userPrompt.length > 4000`, writes prompts to `os.tmpdir()`/`paperclip-pi-system-${runId}.md` and `paperclip-pi-user-${runId}.md`, then passes `@path` / `--append-system-prompt <path>` instead of inline strings.
- **Why fragile:**
  - Threshold 4000 is aggressively low because CreateProcessW also sums env vars + every other CLI arg into its 32k budget; the effective margin is hard to prove from code and hasn't been measured post-env-mutation.
  - The symlink→copyFile fallback in codex-home.ts silently stops syncing the shared codex home after the first copy (see comment at line 72-77). A user who re-authenticates Codex in the shared home will see stale auth in managed homes until server restart.
  - Both patches live deep inside adapters. `pnpm update` of the adapter packages, an automated "simplify" refactor by an agent, or a merge from upstream can silently drop them. No CI guard asserts that `trySymlink` catches `EPERM` or that `WINDOWS_ARG_FALLBACK_THRESHOLD` exists.
  - No companion tests. `packages/adapters/pi-local/src/server/` has `models.test.ts` and `parse.test.ts` but nothing that exercises the `useFilePromptFallback` path.
- **Fix approach:**
  1. Add a unit test in `packages/adapters/pi-local/src/server/execute.test.ts` that stubs `process.platform = "win32"`, feeds a 10k+ char prompt, and asserts tempfile-based args are used.
  2. Add a unit test in `packages/adapters/codex-local/src/server/codex-home.test.ts` that mocks `fs.symlink` to throw `EPERM` and asserts `fs.copyFile` is called.
  3. Add `scripts/check-forbidden-tokens.mjs`-style guard that fails CI if the string `WINDOWS_ARG_FALLBACK_THRESHOLD` or the `EPERM`/`ENOSYS` symlink-fallback branch disappears from those two files.
  4. Consider lifting the arg-limit logic into `packages/adapter-utils` so every CLI-based adapter (Claude, Codex, Cursor, Gemini, Opencode) picks it up; right now it's Pi-only.

### 5. POST/PATCH endpoints returning 500 in real usage

- **Observed (2026-04-23):** The following endpoints failed with 500 today when called with non-trivial payloads:
  - `POST /api/projects` (full body with codebase + executionWorkspacePolicy)
  - `POST /api/projects/:id/workspaces`
  - `PATCH /api/projects/:id` with `executionWorkspacePolicy`
  - `POST /api/companies/:id/issues` in projects lacking `executionWorkspacePolicy`
- **Files:**
  - `server/src/routes/projects.ts:109,166` — references `collectProjectExecutionWorkspaceCommandPaths(body.executionWorkspacePolicy)`. If `executionWorkspacePolicy` is malformed or has side-effects that fail (e.g. worktree provisioning in `server/src/services/execution-workspaces.ts`), the handler bubbles unexpected exceptions.
  - `server/src/routes/issues.ts` — the create-issue handler calls into `server/src/services/issues.ts:1862` which atomically increments `companies.issueCounter`. If the issue is attached to a project and the project has an incomplete `executionWorkspacePolicy`, a downstream call to `services/execution-workspaces.ts` (provisioning a worktree during issue create) can raise.
- **Trigger:** Seen when issuing POST with the workspace-policy-heavy shape generated by v2 migration scripts.
- **Fix approach:**
  1. Reproduce with `curl` + minimal bodies; capture stack trace from `server.log` (the errorContext for 500s includes the PostgresError, but structured handler errors should be equally visible).
  2. Promote schema validation at the Express entrypoint — validate `executionWorkspacePolicy` against a Zod schema in each route before entering the service layer, so bad payloads return 422 with a clear message instead of 500.
  3. Wrap worktree provisioning side-effects in a try/catch that records the failure on the project/issue row (e.g. `worktreeProvisioningError` column) but still returns 201 with a warning — current behavior of silently 500-ing loses the created DB row's identity.

### 6. Orphan v2 issues — projectId=null, identifier=null (backfilled manually)

- **Symptoms:** 25+ issues in the ILM-v2 company (`68892580-9963-4506-a987-90be8d8ddb26`) were discovered on 2026-04-23 with `project_id IS NULL` and `identifier IS NULL`. Fixed manually via SQL `INSERT ... ON CONFLICT UPDATE` backfill.
- **Files / Root cause:**
  - `packages/db/orchestrate-e2e.ts:391-408` — the `cloneNextInboxIssue` helper inserts directly via `sql\`INSERT INTO issues (...) VALUES (...)\`` and does NOT call `server/src/services/issues.ts:createIssue`. The service-layer path (around `services/issues.ts:1862`) is what atomically bumps `companies.issueCounter` and synthesizes `identifier = issuePrefix + '-' + issueCounter`. Bypassing it = no identifier.
  - The same helper reads `project_id` from a lookup (line 384-388) but nothing asserts the project exists; if the ILM Platform project is missing/renamed, `projectId` silently becomes `null` and every downstream issue inherits no project.
- **Impact:**
  - UI lists / references / mentions that key off `identifier` break (shown as raw UUIDs or blank rows).
  - `GET /api/companies/:id/issues?identifier=ILM-19` (server.log line 6726) works only for identifier-tagged rows; orphans are invisible to that query.
  - `filter_by_artist_ids` / project-scoped ACL silently allows orphans to leak into wrong tenants because `project_id` is null.
- **Fix approach:**
  1. Replace direct SQL INSERT in `orchestrate-e2e.ts` with a call to the REST endpoint `POST /api/companies/:id/issues` (or import the `createIssue` service directly). Make this a hard rule — no SQL-level issue creation outside migrations/seed scripts.
  2. Add a DB constraint / CHECK that rejects `issues.identifier IS NULL AND origin_kind != 'system'` so future orphans fail loudly.
  3. Add a startup integrity check in `server/src/services/cron.ts` that logs a WARN on any issue with null identifier.

### 7. Wake without issueId (known pre-existing bug)

- **Symptoms:** Previously documented in the memory file `feedback_paperclip_windows_ops.md`. Wakes triggered without an `issueId` end up on orphan runs that never resolve back to a visible task in the UI.
- **Files:**
  - `server/src/services/heartbeat.ts:6331` — `enqueueWakeup` call site (the one that surfaces 409 "Agent is not invokable" errors at server.log lines 6686, 6710, 6734).
- **Trigger:** Issue comments / external triggers enqueuing wakeups when the agent is in a non-invokable state (e.g. `status: "paused"`) AND when the wake context lacks `taskId`/`issueId`.
- **Fix approach:** Per the existing memory note — reject wake requests at the route level if the target agent has no pinned issueId context. Currently the wake path logs a WARN and proceeds; it should respond 409 to the caller with the reason, and the client code that enqueues these (issue comment hook, dispatcher) should backoff rather than retry-storm. Grep `enqueueWakeup` call sites to enforce.

### 8. 403 on PATCH /api/issues/:id during handoff assignment

- **Symptoms:** `PATCH /api/issues/7a92c708-8310-4fb0-b961-8578884a0fa6` returned 403 at `2026-04-23T12:30:03` (server.log line 28504). Body: `{ "status": "blocked", "assigneeAgentId": "ab049060-1547-4303-9d91-69500a404da3" /* CTO */, "comment": "## Handoff ... wrong assignee; type=frontend belongs to CTO" }`. 15 seconds later (`12:30:18`, line 28505) the same PATCH minus one character succeeded — indicates the 403 was permission-based, not payload-validation-based.
- **Files:**
  - `server/src/routes/issues.ts:468-477` — "Missing permission to link approvals" / "Forbidden" branches.
  - `server/src/routes/issues.ts:1635,1701` — `if (req.body.assigneeAgentId || req.body.assigneeUserId)` gates for self-assignment.
  - `server/src/routes/issues.ts:556-575` — `hasActiveCheckoutManagementOverride` policy check, called when `issue.assigneeAgentId !== actorAgentId`.
- **Trigger:** Agent-to-agent handoff (BackendDev → CTO / SecurityAuditor) where the acting agent tries to reassign to another agent. The permission system requires either `allowIssueOverride` or an active checkout-management override to let agent X move an issue to agent Y.
- **Fix approach:**
  1. Define the policy explicitly in `server/src/services/agent-permissions.ts` — whether handoff transitions are allowed for all agents or gated on a role. Currently the code paths appear to rely on ad-hoc checks spread across `issues.ts`.
  2. Add a unit test: agent A patches issue to assignee B with `comment` containing a handoff payload → should succeed when `lifecycle_state` is transitioning to a terminal / review state; fail otherwise.
  3. Surface the specific reason in the 403 body instead of generic "Forbidden" — today the body `"Forbidden"` gives 0 debug info (content-length 44).

---

## Tech Debt

### Overnight orchestrator has no cost-circuit-breaker on repeat failures

- **Files:** `packages/db/orchestrate-e2e.ts:592-644` — main loop checks `spend >= BUDGET_USD_CAP` ($50 hard cap at line 48) but nothing detects "the last N transitions on this issue all failed with the same error".
- **Impact:** During the `pr_open → spec_d` bug (issue #3 above), the orchestrator looped roughly from 12:36:02 to some time after 12:40:27 (at least 6 observed 422s) re-invoking Claude Opus on each retry. Reported damage: approximately $38 spent before the run was killed. Budget cap at $50 was never triggered because total spend stayed under.
- **Fix approach:**
  1. Track `(issueId, from, to) → consecutive failures` counter. Bail after 2 identical 4xx responses.
  2. Per-issue cost cap independent of global cap (e.g. $10/issue). Reset only on lifecycle advance.
  3. Exponential backoff between retries — current `LOOP_SLEEP_BETWEEN_ISSUES_MS = 30_000` (30s) applies only between issues, not between retries of the same transition.

### Direct SQL data manipulation bypasses service-layer invariants

- **Files:** `packages/db/orchestrate-e2e.ts:391`, `packages/db/set-assignee.ts`, `packages/db/dispatch-integration.ts`, `packages/db/scripts/*`, `server/scripts/`.
- **Impact:** Same root cause as orphan issues (#6). Anything that talks to Postgres without going through `server/src/services/issues.ts`, `server/src/services/agents.ts` etc. can skip identifier assignment, ACL enforcement, activity logging, `issue_references` mention backfill, etc.
- **Fix approach:** Establish a conventions rule in `skills/` that all mutation scripts outside migrations MUST call the REST API or import the service module. Add a lint rule / `scripts/check-forbidden-tokens.mjs` entry that flags `sql\`INSERT INTO (issues|agents|companies)` in non-migration, non-seed files.

### Hardcoded DB credentials in orchestrator script

- **Files:** `packages/db/orchestrate-e2e.ts:31` — `const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";`.
- **Impact:** Local embedded Postgres default creds, not a prod leak. But committing this sets a precedent and gets copy-pasted into new scripts. Also: other constants (CEO_ID, CTO_ID, BACKEND_ID, company IDs) are hardcoded to this single installation (line 32-41) — the script cannot be reused by any other Paperclip instance.
- **Fix approach:** Read from `process.env.DATABASE_URL` with a fallback. Read agent IDs from `/api/companies/:id/agents` by role instead of hardcoding.

### Giant files — heartbeat.ts and issues.ts routes

- **Files:**
  - `server/src/services/heartbeat.ts` — 7,359 lines.
  - `server/src/routes/issues.ts` — 3,556 lines.
  - `server/src/routes/access.ts` — 4,389 lines.
  - `server/src/services/company-portability.ts` — 4,534 lines.
  - `server/src/services/workspace-runtime.ts` — 2,930 lines.
- **Why fragile:** Any change to heartbeat dispatch, wake, cost tracking, or run lifecycle touches a single 7k-line file; merge conflicts are near-certain in multi-agent work. Bug #3 and bug #7 both stack-traced into `heartbeat.ts` — the file is the dominant source of runtime exceptions.
- **Fix approach:** Split heartbeat.ts along its boundaries (wake vs dispatch vs run-execution vs cost-tracking vs timeout-management) before adding more features. Guard with invariant tests first.

### ILM-v2 adapters aren't yet in `skills/` or policy for execute-shell

- **Files:** `packages/adapters/*/src/server/` — each adapter has its own copy of env-merging, skill-injection, Windows-fallback logic. `packages/adapter-utils/` exists but several behaviors (arg-limit, symlink fallback) haven't been lifted into it.
- **Fix approach:** Audit duplication across `claude-local`, `codex-local`, `cursor-local`, `gemini-local`, `pi-local`, `opencode-local`. Lift genuinely shared logic into `adapter-utils`. The Windows patches are candidate #1.

---

## Security Considerations

### Secrets in drafts/ and scripts

- **Files:**
  - `C:\Users\ilm\.paperclip\drafts\ILM-v2\NEXT-STEPS.md` — grep for `sk-`, `api_key`, `token`, `password`, `secret` returned matches (word presence only, not verified secret values). Needs manual review to confirm whether matches are prompts/docs vs real tokens.
  - `packages/db/orchestrate-e2e.ts:31` — hardcoded local DB password (low severity but wrong precedent).
  - `scripts/` — multiple seed / helper scripts (`_seed-paperclip-*.ts`, `enable-codex-write.ts`, `ilm-v2-seed.ts`) should be audited for hardcoded tokens before any future push to a public fork or accidental commit.
- **Risk:** Drafts live outside the repo (`~/.paperclip/drafts/`) so they don't hit git — but any copy-paste into a committed file (e.g. a runbook under `docs/`) would leak. Bearer tokens and Spotify-for-Artists auth documented in the user's global CLAUDE.md would be high-value targets.
- **Current mitigation:** Drafts directory is not a git worktree; `.gitignore` covers `.env*`. Redaction logic exists in `server/src/log-redaction.ts`, `server/src/redaction.ts`, `server/src/services/feedback-redaction.ts`.
- **Recommendations:**
  1. Run `scripts/check-forbidden-tokens.mjs` against drafts periodically (extend it to scan arbitrary directories).
  2. Add a pre-commit hook: reject commits that introduce strings matching `sk-(ant|proj)-[a-zA-Z0-9_-]{32,}`, `ghp_[A-Za-z0-9]{30,}`, `Bearer [A-Za-z0-9_.-]{40,}`, PostgreSQL URLs with inline passwords, Supabase service role keys.
  3. Move `DB_URL` in `orchestrate-e2e.ts` to `process.env.DATABASE_URL`.

### No auth-bypass in current code (verified)

- Grep for `skip.*auth|DEV_BYPASS|!isSupabaseConfigured|auth_bypass` returned 1 hit in `server/src/__tests__/workspace-runtime-service-authz.test.ts` (test file only). The lesson from the user's global CLAUDE.md ("nunca usar !isSupabaseConfigured() como bypass de auth em prod") appears to be respected in production code. Keep this clean as new routes are added.

### Local agent JWT secret missing — warns but proceeds without auth

- **Files:** `server/src/services/heartbeat.ts` (log line: `[15:18:06] WARN: local agent jwt secret missing or invalid; running without injected PAPERCLIP_API_KEY`, server.log line 594).
- **Impact:** Adapter run proceeds with no `PAPERCLIP_API_KEY`, meaning anything downstream that expects an authenticated callback will fail (observed: `[15:18:06] ERROR: heartbeat execution failed`, line 596).
- **Fix approach:** Treat missing JWT secret as a fatal startup error in non-test environments. `server/src/agent-auth-jwt.ts` should throw on boot if the secret is empty/invalid, rather than proceeding silently.

---

## Performance Bottlenecks

### Heartbeat-runs endpoint returning 462 KB payloads

- **Files:** `server/src/routes/issues.ts` (or `server/src/routes/agents.ts`) — endpoint `GET /api/companies/:id/heartbeat-runs?limit=200`.
- **Observed:** server.log line 6751 — response payload content-length `462318` bytes (452 KB) at responseTime 119 ms. Similar request at line 6752 also 462 KB at 143 ms. This endpoint is polled from the dashboard UI.
- **Fix approach:** Paginate by default (limit=25), return a summary/shape-light projection for lists, and a detail endpoint for one run. Add `prevCursor`/`nextCursor` fields.

### Repeated `GET /api/companies/:id/issues` re-emits ~80 KB etag-unchanged responses

- **Observed:** server.log lines 28554, 28557, 28558, 28559 — 4 consecutive GETs in 20 seconds with identical etag `"13ba7-2zB4fRiHVORuA0wTFq+eFFhOI8Y"` and `content-length: 80807`. No client is honoring `If-None-Match` (no such header in those requests).
- **Fix approach:** Either fix clients to send `If-None-Match` so the server can 304, or add server-side caching with a TTL keyed by (companyId, max(updatedAt)).

### `server/src/services/heartbeat.ts` is 7,359 lines

- Covered under Tech Debt but worth restating for perf: every heartbeat tick traverses module-scope state. Splitting it also helps TypeScript compile time and hot-reload.

---

## Fragile Areas

### Orchestrator state machine resume logic

- **Files:** `packages/db/orchestrate-e2e.ts:608-631` — `inFlight` detection happens but the subsequent `processIssue(issue)` call never branches on `inFlight[0].lifecycle_state`. The comment at line 310 even acknowledges the fallback ("Research-only flow in that case") without guarding other states.
- **Why fragile:** Any future addition to the state machine (e.g. a `security_audit_d` phase inserted between review and pr_open) will reintroduce the same loop bug because resume still starts at `spec_d`.
- **Safe modification:** Refactor `processIssue` into an explicit FSM: `function stepFrom(state: LifecycleState, issue): LifecycleState`. Call it in a loop with a safety counter. Each arm documents its entry requirements.
- **Test coverage gaps:** No automated test for orchestrator resume paths. `packages/db/` has `vitest.config.ts` but orchestrate-e2e.ts has no companion `.test.ts`.

### Heartbeat "Agent is not invokable" warnings spam the log

- **Files:** `server/src/services/heartbeat.ts:6331`.
- **Observed:** 3 warnings in 34 seconds (server.log lines 6686, 6710, 6734) from 3 different comments trying to wake paused agents. The issue comment intake does not check `agent.status === "paused"` before enqueueing.
- **Safe modification:** Add a guard in the issue-comment intake handler (wherever `queueIssueAssignmentWakeup` or similar is called from) that returns 202 Accepted + "agent paused" without enqueueing. Currently each paused-agent comment produces stderr noise and a failed enqueue attempt.

### Dashboard UI likely shows orphan-metadata issues

- **Files:**
  - `ui/` — any list view that reads `identifier` and falls back to `id` shows partial UUIDs for rows with null identifier.
  - Observed via `GET /api/companies/.../issues` returning 80k+ JSON including rows whose identifier is null (now backfilled).
- **Why fragile:** Before today's backfill, users would see 25+ rows with no ID label next to the title. No error, just silent UX degradation. The dashboard has no guard "if identifier == null then render warning badge" — absence is indistinguishable from correct render.
- **Safe modification:** Add a `MissingIdentifierBadge` component shown when identifier is null. Simultaneously fix the root cause (#6 above).

### Worktree collision logic returns 500 instead of a recoverable code

- **Files:** heartbeat execution path that provisions worktrees (see server.log lines 28362-28449 for repeated "Configured worktree path already exists and is not a reusable git worktree").
- **Why fragile:** A collision on one issue's worktree (caused by a stuck worktree HEAD, here `paperclip/overnight-2026-04-23`) blocked every subsequent issue that hashed to the same template path. The 500 response doesn't communicate "try a different path" back to the caller.
- **Safe modification:** When a worktree is not reusable, detect, log WARN, and provision a sibling path (append `-2`, `-3`) up to a sane cap. If still unreusable, return 409 Conflict with guidance, not 500.

---

## Dependencies at Risk

### embedded-postgres@18.1.0-beta.16 with a local patch

- **Files:** `patches/embedded-postgres@18.1.0-beta.16.patch` — the only vendored patch in the repo.
- **Risk:** Any upgrade of `embedded-postgres` requires manually re-applying the patch. A beta dependency tied to a specific version is a maintenance burden.
- **Impact:** Local dev DB (`127.0.0.1:54329/paperclip`) relies on it. If the patch breaks, nobody can run the server locally.
- **Migration plan:** Track upstream for a release that makes the patch unnecessary. If one ships, rebase to stable; if not, pin the minor and add a CI job that boots an embedded Postgres against a smoke migration to catch regressions early.

### Pi adapter — Pi CLI contract is external and undocumented

- **Files:** `packages/adapters/pi-local/src/server/execute.ts:384-419` (`buildArgs`).
- **Risk:** Uses `--mode json`, `-p`, `--append-system-prompt`, `--tools read,bash,edit,write,grep,find,ls`, `--session`, `--skill`, `@path`. If Pi's CLI changes argument names or removes `@path` file references, every run breaks silently.
- **Mitigation:** `ensurePiModelConfiguredAndAvailable` (line 221-226) at least validates model availability before spawning. Extend to validate CLI syntax (e.g. `pi --help` parse) on first use per process.

---

## Missing Critical Features

### No orchestrator dry-run mode

- **Problem:** To verify changes to `orchestrate-e2e.ts` you must either let it burn real budget against Claude Opus/Codex or manually patch constants.
- **Blocks:** Safe iteration on state-machine logic, cost-control logic, retry logic.
- **Fix approach:** Add `DRY_RUN=1` env guard. In dry run: stub `invokeClaude` to return canned markdown, stub `httpTransition` to hit a local recorder. Unit test each FSM arm without spending a cent.

### No per-agent cost anomaly detection

- **Problem:** The orchestrator checks total spend against a $50 cap but nothing alerts on "agent X spent $20 on a single issue in 10 minutes".
- **Blocks:** Early exit on the exact failure mode of bug #3 (repeated Opus calls re-spec-ing the same issue).
- **Fix approach:** Track `spend_per_(agent, issue, hour)` and alert when any window exceeds $5 (or similar).

### No structured migration for FK cascade fix

- **Problem:** Bug #1 requires a drizzle migration. There's no automation to generate the migration given a schema change.
- **Fix approach:** Standard drizzle-kit workflow is `pnpm -C packages/db drizzle:generate`. Document this in `packages/db/CHANGELOG.md` and gate PRs that modify schema files against the migration folder delta.

---

## Test Coverage Gaps

### Windows platform patches untested

- **Files not tested:**
  - `packages/adapters/codex-local/src/server/codex-home.ts` (symlink fallback) — no `.test.ts` sibling.
  - `packages/adapters/pi-local/src/server/execute.ts` (arg-limit fallback) — has `parse.test.ts` and `models.test.ts` but none for `execute`.
- **Risk:** A refactor on macOS/Linux can drop the Windows fallback without any test failing locally, blowing up only at runtime on the ILM Windows notebook.
- **Priority:** HIGH.

### Orchestrator resume paths untested

- **File:** `packages/db/orchestrate-e2e.ts` — no companion test file.
- **Risk:** Bug #3 was the direct manifestation of this gap.
- **Priority:** HIGH.

### DELETE /api/companies cascade path untested

- **File:** `server/src/routes/companies.ts` — no test that creates a company with heartbeat runs + cost events and then DELETEs it.
- **Risk:** Bug #1 slipped through because the schema cascade was never exercised end-to-end.
- **Priority:** MEDIUM — workaround exists (archive status).

### Worktree provisioning collision path untested

- **File:** `server/src/services/execution-workspaces.ts` (and whatever invokes it from `heartbeat.ts`).
- **Risk:** Bug #2 made issue creation and heartbeat dispatch unusable for 18+ minutes without any smoke alarm.
- **Priority:** HIGH — this blocks the whole pipeline when it fires.

### Orphan issue invariant untested

- **File:** `server/src/services/issues.ts` around the `issueCounter` increment (line 1862).
- **Risk:** Bug #6 allowed 25+ rows with null identifier to survive in prod DB.
- **Priority:** MEDIUM — a DB CHECK would catch future occurrences even without a unit test.

### Agent permission matrix (403s) untested at route level

- **File:** `server/src/routes/issues.ts:468-577`.
- **Risk:** Bug #8's 403-then-200 pattern (first PATCH rejected, second accepted) suggests the permission layer has edge cases nobody has mapped. A reference-spec test covering agent-to-agent handoff for every (from_role, to_role, lifecycle_state) triple would catch regressions.
- **Priority:** MEDIUM.

---

*Concerns audit: 2026-04-23*
