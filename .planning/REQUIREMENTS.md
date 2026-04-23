# Requirements — Milestone v1.0: Fix paperclip v2 bugs (overnight reliability)

## v1.0 Requirements

### Orchestrator (ORCH)

- [ ] **ORCH-01**: Orchestrator resume respects current `lifecycle_state` — when restarting, `processIssue` dispatches to the correct stage (inbox→spec, spec_d→plan, planned→impl, implementing→review, review→pr_open, pr_open→merge) and never attempts a forbidden transition like `pr_open → spec_d`.
- [ ] **ORCH-02**: Per-issue retry cap — after N (default 3) failed transitions on the same `from → to` edge within a single orchestrator run, the issue is parked (`lifecycle_state=failed`) and the loop advances; no further Claude invocations on that edge.
- [ ] **ORCH-03**: Budget circuit breaker — orchestrator checks `spend_today` BEFORE each Claude invocation (not only at loop-iter boundary); when `spend_today + estimated_step_cost >= BUDGET_USD_CAP`, the loop halts with a `budget_exceeded` log line and `status.json` phase=`halted_budget`.

### Database / Schema (DB)

- [x] **DB-01**: DELETE `/api/companies/:id` succeeds for companies with prior heartbeat runs — `cost_events.heartbeat_run_id` FK is redeclared with `onDelete: "set null"` (or `"cascade"`) in `packages/db/src/schema/cost_events.ts`, a drizzle migration is generated and applied, and the DELETE handler explicitly prunes `cost_events` rows first as a belt-and-braces check. **Complete 2026-04-23 via plan 01-01 (commits 19b12a0d, d0079a1c, ddfa9a02); see `.planning/phases/01-schema-data-integrity-foundation/01-01-SUMMARY.md`.**
- [ ] **DB-02**: Issue creation is atomic — every INSERT into `issues` populates `project_id` and `identifier` in the same transaction that increments `companies.issue_counter`. The overnight orchestrator's issue-creation path uses the same service (`server/src/services/issues.ts:1862`) as the API, not direct SQL bypasses.

### Execution Workspace (EXEC)

- [ ] **EXEC-01**: Worktree path templates interpolate variables correctly — `${issueId}`/`{{issue.identifier}}` tokens in `workspaceStrategy.branchTemplate` and `worktreeParentDir` produce real paths (no literal `$issue_id` in filesystem). A config validator rejects any template string still containing an unresolved `$var` or `${var}` at project load.

### API Validation (API)

- [ ] **API-01**: POST `/api/projects`, POST `/api/projects/:id/workspaces`, PATCH `/api/projects/:id`, POST `/api/companies/:id/issues` validate their request bodies against Zod schemas at the Express entry point. Bad payloads return 422 with `{ error, details: [...] }`, not 500.
- [ ] **API-02**: Side-effects in issue/project create (worktree provisioning, file allocation) are wrapped in try/catch. On failure, the handler records `worktreeProvisioningError` (or equivalent) on the created row and returns 201 with a warning header — the DB row is preserved, the client is informed, no 500 masks lost state.

### Testing & CI (TEST)

- [ ] **TEST-01**: Windows patches are covered by tests and CI guards:
  - `packages/adapters/pi-local/src/server/execute.test.ts` — stubs `process.platform = "win32"`, feeds a 10k+ char prompt, asserts tempfile-based args are used (the `useFilePromptFallback` branch).
  - `packages/adapters/codex-local/src/server/codex-home.test.ts` — mocks `fs.symlink` to throw `EPERM`, asserts `fs.copyFile` is called.
  - `scripts/check-forbidden-tokens.mjs` (or equivalent) asserts `WINDOWS_ARG_FALLBACK_THRESHOLD` and the `EPERM`/`ENOSYS` branch survive in those files; wired into CI or pre-commit.
- [ ] **TEST-02**: Orchestrator resume has an integration test (`packages/db/__tests__/orchestrate-e2e.test.ts` or equivalent) covering each `lifecycle_state` entry point: the test inserts an issue in each state, runs one tick of the orchestrator, asserts the correct next action (invoke CEO, CTO, BackendDev, merge, park), and asserts no forbidden transition is emitted.

### Operations (OPS)

- [ ] **OPS-01**: A reusable post-mortem SQL playbook exists at `scripts/postmortem-stuck-orchestrator.ts` that (a) inspects `.paperclip/ops/status.json` + `overnight-*.log`, (b) force-parks the poisoned issue (`lifecycle_state=merged` or `failed`), (c) backfills orphan `project_id`/`identifier` on any rows still null, (d) prints a recovery report. Supersedes the one-off `_fix-runaway.ts` / `_fix-orphans.ts` scripts from 2026-04-23.

## Future Requirements (v1.1+)

- Dashboard UI polish (orphan metadata visibility, stale identifier warnings)
- Upstream PR to `paperclipai/paperclip` with Windows patches + FK fix
- Tier-4 budget handling with resume-with-approval
- Promote `cursor-local` / `openclaw-gateway` adapters from experimental
- Replace Claude-Opus-in-loop spec generation with a cheaper pre-generation step
- Multi-operator auth (beyond the single Adya user)

## Out of Scope (v1.0)

- **Cloud hosting migration** — ILM explicitly runs self-hosted; data sovereignty outweighs convenience.
- **Multi-tenant auth** — the notebook operator is trusted; no hardening against untrusted local users in this milestone.
- **Windows Developer Mode prerequisite** — patches exist specifically so Adya can run without Admin; dropping the patches is not an option.
- **Adapter interface rewrite** — patches stay local; upstream PR is future work.
- **Full migration of the stale `ILM` v1 company data** — v1 is archived, soft-deleted; not restoring agent runs or cost history from it.

## Traceability

Every v1.0 requirement is mapped to exactly one phase. Phases are derived in `.planning/ROADMAP.md`.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 — Schema & data-integrity foundation | complete (plan 01-01, 2026-04-23) |
| DB-02 | Phase 1 — Schema & data-integrity foundation | pending |
| ORCH-01 | Phase 2 — Orchestrator bleed-stopper | pending |
| ORCH-02 | Phase 2 — Orchestrator bleed-stopper | pending |
| ORCH-03 | Phase 2 — Orchestrator bleed-stopper | pending |
| API-01 | Phase 3 — API hardening & workspace interpolation | pending |
| API-02 | Phase 3 — API hardening & workspace interpolation | pending |
| EXEC-01 | Phase 3 — API hardening & workspace interpolation | pending |
| TEST-01 | Phase 4 — Test safety net | pending |
| TEST-02 | Phase 4 — Test safety net | pending |
| OPS-01 | Phase 5 — Operator recovery playbook | pending |

**Coverage:** 11/11 requirements mapped ✓
