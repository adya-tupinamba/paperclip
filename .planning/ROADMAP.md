# Roadmap — Milestone v1.0: Fix paperclip v2 bugs (overnight reliability)

**Generated:** 2026-04-23
**Granularity:** coarse (per `.planning/config.json`)
**Parallelization:** enabled
**Total v1.0 requirements:** 11 (all mapped, 100% coverage)

## Core Goal

Make the overnight orchestrator (`packages/db/orchestrate-e2e.ts`) safe to leave running unattended. On 2026-04-23 it bled ~$38 of Claude Opus in a `pr_open → spec_d` retry loop, produced 25+ orphan issues with null `projectId`/`identifier`, and `DELETE /api/companies/:id` returned 500 on a missing FK cascade. This milestone removes each class of failure with goal-backward success criteria and companion tests.

## Phases

- [ ] **Phase 1: Schema & data-integrity foundation** — Fix FK cascade on `cost_events`, make issue creation atomic; unblock hard-delete testing and eliminate orphan rows.
- [ ] **Phase 2: Orchestrator bleed-stopper** — State-machine resume, per-edge retry cap, pre-invocation budget circuit breaker. Stops the overnight money leak.
- [ ] **Phase 3: API hardening & workspace interpolation** — Zod validation at route entry, wrapped worktree side-effects, template interpolation for `${issueId}`. 500s become 422/201-with-warning.
- [ ] **Phase 4: Test safety net for Windows patches & orchestrator resume** — Companion Vitest suites + CI guard so the fixes from phases 2–3 don't silently regress on refactors.
- [ ] **Phase 5: Operator recovery playbook** — `scripts/postmortem-stuck-orchestrator.ts` supersedes the one-off `_fix-runaway.ts` / `_fix-orphans.ts` scripts.

## Phase Details

### Phase 1: Schema & data-integrity foundation
**Goal**: A company with prior heartbeat runs can be hard-deleted; every new issue has a non-null `project_id` and `identifier` at commit time.
**Depends on**: Nothing (foundational — unblocks Phase 4's end-to-end DELETE test and removes the need for soft-delete workarounds).
**Requirements**: DB-01, DB-02
**Success Criteria** (what must be TRUE):
  1. `curl -X DELETE http://127.0.0.1:3100/api/companies/:id` returns 200 for a company that has prior `heartbeat_runs` with attached `cost_events` (reproduces the 2026-04-23 case on company `f0c2b690-0bad-4421-8043-2f4a328df440`).
  2. A new drizzle migration in `packages/db/src/migrations/` declares `cost_events.heartbeat_run_id` with `onDelete: "set null"` (or `"cascade"`) and `pnpm -C packages/db db:migrate` applies cleanly against a fresh embedded Postgres.
  3. Every row inserted into `issues` through the overnight orchestrator (`packages/db/orchestrate-e2e.ts`) has non-null `project_id` AND non-null `identifier` — verified by a SQL assertion after a fresh orchestrator run. No 25-row orphan batch like 2026-04-23.
  4. Orchestrator issue creation goes through `server/src/services/issues.ts::createIssue` (service layer) instead of a raw `sql\`INSERT INTO issues...\`` bypass — grep confirms no `INSERT INTO issues` in `packages/db/orchestrate-e2e.ts`.
**Plans**: 3 plans
  - [ ] 01-01-PLAN.md — FK onDelete set null on cost_events + reorder companyService.remove + verify pg_constraint (DB-01, wave 1)
  - [ ] 01-02-PLAN.md — Refactor orchestrate-e2e.ts to use issueService.create, removing raw INSERT INTO issues (DB-02, wave 1)
  - [ ] 01-03-PLAN.md — Idempotent backfill-issue-metadata.ts promoted from scripts/_fix-orphans.ts (DB-02 support, wave 2)

### Phase 2: Orchestrator bleed-stopper
**Goal**: The overnight orchestrator resumes issues from their current `lifecycle_state`, caps retries per failing edge, and halts BEFORE spending past `BUDGET_USD_CAP`.
**Depends on**: Phase 1 (atomic issue creation means the orchestrator's resumed rows actually have valid `project_id`/`identifier` to dispatch against).
**Requirements**: ORCH-01, ORCH-02, ORCH-03
**Success Criteria** (what must be TRUE):
  1. Given an issue at `lifecycle_state = pr_open`, one orchestrator tick dispatches to the merge step, not the CEO spec step — no `POST /api/issues/.../transition { to: "spec_d" }` 422 appears in the server log for an already-past-spec_d issue.
  2. After 3 consecutive failed transitions on the same `(issueId, from, to)` edge, the orchestrator parks the issue with `lifecycle_state = failed` and advances to the next inbox issue — the 4th retry never invokes Claude Opus.
  3. With `BUDGET_USD_CAP=50` and `spend_today=48.00`, when the next estimated step cost is $5.00, the orchestrator halts BEFORE invoking Claude, writes `phase: "halted_budget"` to `C:\Users\ilm\.paperclip\ops\status.json`, and logs `budget_exceeded` — total spend stays under the cap.
  4. `packages/db/orchestrate-e2e.ts` exposes a testable FSM entry point (e.g. `stepFrom(state, issue)`) so Phase 4's integration test can drive each `lifecycle_state` without real Claude spend.
**Plans**: TBD

### Phase 3: API hardening & workspace interpolation
**Goal**: Malformed payloads and unresolved worktree templates return structured 4xx, not 500; worktree provisioning failures never leave an orphan DB row without telling the caller.
**Depends on**: Phase 1 (atomic issue create is the contract the wrapped side-effects preserve).
**Requirements**: API-01, API-02, EXEC-01
**Success Criteria** (what must be TRUE):
  1. `POST /api/projects`, `POST /api/projects/:id/workspaces`, `PATCH /api/projects/:id`, and `POST /api/companies/:id/issues` all return 422 with `{ error, details: [...] }` for malformed `executionWorkspacePolicy` payloads — none return 500 (reproduces the 2026-04-23 failure where v2 migration-shaped bodies all 500'd).
  2. When worktree provisioning fails during issue create, the DB row is preserved, the response is 201 with a `worktreeProvisioningError` field populated on the row, and the server log captures the root cause — no 500 masks the lost identity.
  3. Loading a project whose config has a literal `$issue_id` or unresolved `${var}` token in `workspaceStrategy.branchTemplate` / `worktreeParentDir` fails loudly at config-load time — the validator rejects it with a clear message instead of rendering the literal into a filesystem path.
  4. A fresh heartbeat run provisions a worktree at a real path (e.g. `C:\Users\ilm\Documents\GitHub\ilm-worktrees\paperclip\ILM-42`) — no `-issue_id` or `$issue_id` literals appear under `C:\Users\ilm\Documents\GitHub\ilm-worktrees\`.
**Plans**: TBD

### Phase 4: Test safety net for Windows patches & orchestrator resume
**Goal**: Every fix from Phases 2–3 and every Windows-only fallback has a Vitest companion that fails if the fallback branch disappears; CI blocks merges that drop the Windows patches.
**Depends on**: Phase 2 (resume FSM must expose a testable entry point) and Phase 1 (DB-01 enables the end-to-end DELETE path that one test exercises).
**Requirements**: TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. `pnpm test:run` executes `packages/adapters/pi-local/src/server/execute.test.ts` which stubs `process.platform = "win32"`, feeds a 10k+ char prompt, and asserts the tempfile-based args path is taken (`--append-system-prompt <path>`, not inline).
  2. `pnpm test:run` executes `packages/adapters/codex-local/src/server/codex-home.test.ts` which mocks `fs.symlink` to throw `EPERM` and asserts `fs.copyFile` is called.
  3. A CI guard script (extension of `scripts/check-forbidden-tokens.mjs` or a new `scripts/check-windows-patches.mjs`) fails if the strings `WINDOWS_ARG_FALLBACK_THRESHOLD` or the `EPERM`/`ENOSYS` symlink-fallback branch disappear from those two adapter files — wired into `pnpm test:run` or the pre-push hook.
  4. `packages/db/__tests__/orchestrate-e2e.test.ts` (or equivalent) covers each `lifecycle_state` entry point (`inbox`, `spec_d`, `planned`, `implementing`, `review`, `pr_open`, `blocked`): inserts an issue in that state, runs one FSM tick, asserts the correct next action and that no forbidden transition is emitted. The `pr_open → spec_d` loop from 2026-04-23 is explicitly covered as a regression test.
**Plans**: TBD

### Phase 5: Operator recovery playbook
**Goal**: When the orchestrator wedges overnight, the operator runs one script to inspect state, force-park the poisoned issue, backfill orphan metadata, and print a recovery report — no more copy-paste of ad-hoc SQL.
**Depends on**: Phases 1–4 (the recovery script queries state that only exists after the schema fix, resume FSM, and atomic-create paths are in place).
**Requirements**: OPS-01
**Success Criteria** (what must be TRUE):
  1. `pnpm tsx scripts/postmortem-stuck-orchestrator.ts` exists, reads `C:\Users\ilm\.paperclip\ops\status.json` + the most recent `overnight-*.log`, and prints a human-readable diagnosis (stuck issue id, last attempted transition, last error, spend-to-date).
  2. The script offers a `--force-park <issueId>` flag that transitions the named issue to `lifecycle_state = failed` (or `merged` on `--merge`) via the service layer, not raw SQL.
  3. The script offers a `--backfill-orphans` flag that populates `project_id` and `identifier` on any issue row where they are null, matching the behavior of the one-off `_fix-orphans.ts` from 2026-04-23 but idempotent.
  4. The ad-hoc `scripts/_fix-runaway.ts`, `scripts/_cancel-runaway-issue.ts`, `scripts/_fix-orphans.ts` are either deleted or documented as "see `scripts/postmortem-stuck-orchestrator.ts`" so operators have one canonical entry point.
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema & data-integrity foundation | 0/3 | Planned | — |
| 2. Orchestrator bleed-stopper | 0/TBD | Not started | — |
| 3. API hardening & workspace interpolation | 0/TBD | Not started | — |
| 4. Test safety net | 0/TBD | Not started | — |
| 5. Operator recovery playbook | 0/TBD | Not started | — |

## Coverage Validation

All 11 v1.0 requirements mapped, no orphans, no duplicates:

| Requirement | Phase |
|-------------|-------|
| DB-01 | Phase 1 |
| DB-02 | Phase 1 |
| ORCH-01 | Phase 2 |
| ORCH-02 | Phase 2 |
| ORCH-03 | Phase 2 |
| API-01 | Phase 3 |
| API-02 | Phase 3 |
| EXEC-01 | Phase 3 |
| TEST-01 | Phase 4 |
| TEST-02 | Phase 4 |
| OPS-01 | Phase 5 |

**Mapped: 11/11 ✓**

## Notes on Phase Ordering

- **Phase 1 is the foundation** — DB-01 unblocks the end-to-end DELETE path that Phase 4 asserts; DB-02 removes the orphan-row class that was caused by the orchestrator's raw SQL bypass, which Phase 2's resume logic depends on having fixed.
- **Phase 2 is the bleed-stopper** — it directly stops the recurrence of the 2026-04-23 money leak. Safe to parallelize with Phase 3 after Phase 1 lands, since the two touch disjoint files (`packages/db/orchestrate-e2e.ts` vs `server/src/routes/projects.ts` + `server/src/services/execution-workspace-policy.ts`).
- **Phase 3 hardens the API surface** — the Zod gates and wrapped side-effects preserve the Phase 1 atomic-create contract under bad-input conditions; EXEC-01's config validator catches worktree template bugs at load time instead of at provision time.
- **Phase 4 is the regression firewall** — every bug fixed in 2–3 needs a test that fails if it comes back. The Windows patch tests protect against cross-platform refactor drift; the orchestrator FSM test covers the exact `pr_open → spec_d` loop from 2026-04-23.
- **Phase 5 is the recovery playbook** — lowest priority because it's operator ergonomics, not production safety. But it formalizes the ad-hoc knowledge from the 2026-04-23 recovery so the next incident doesn't require re-inventing SQL.

## Context

- **Repo:** `C:\Users\ilm\Documents\GitHub\paperclip`
- **Active branch:** `ilm-v2-reformulation`
- **Company under test:** `ILM-v2` (`68892580-9963-4506-a987-90be8d8ddb26`)
- **Embedded Postgres:** `postgres://paperclip:paperclip@127.0.0.1:54329/paperclip`
- **Ops logs:** `C:\Users\ilm\.paperclip\ops\` (includes `overnight-2026-04-23.log`, `status.json`)
- **Instance data:** `C:\Users\ilm\.paperclip\instances\default\`
- **Codebase map:** `.planning/codebase/` (CONCERNS.md, ARCHITECTURE.md, STRUCTURE.md, TESTING.md)
- **Existing tests:** 186 Vitest tests in `server/src/__tests__/` + co-located ILM-v2 service tests in `server/src/services/*.test.ts`

---
*Last updated: 2026-04-23 at roadmap creation*
