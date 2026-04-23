# STATE — Paperclip v1.0 (overnight reliability)

**Last updated:** 2026-04-23 (plan 01-03 complete — Phase 1 DONE 3/3)

## Project Reference

- **Project:** Paperclip — self-hosted AI agent orchestration platform for ILM ops
- **Milestone:** v1.0 — Fix paperclip v2 bugs (overnight reliability)
- **Core value:** The overnight orchestrator (`packages/db/orchestrate-e2e.ts`) must reliably drive issues through the 11-state lifecycle without infinite-looping, silently burning budget, or corrupting metadata.
- **Current focus:** Phase 1 complete — transitioning to Phase 2 (orchestrator bleed-stopper).

## Current Position

- **Phase:** 1 of 5 — Schema & data-integrity foundation — **COMPLETE (3/3 plans)**
- **Plan:** 01-03 complete; next is Phase 2 (ORCH-01/02/03, plans TBD)
- **Status:** Phase 1 done; awaiting Phase 2 kickoff via `/gsd-transition` or `/gsd-plan-phase 2`
- **Overall progress:** `[██░░░░░░░░] 1/5 phases complete`
- **Requirements progress:** `[██░░░░░░░░░] 2/11 requirements complete`

## Performance Metrics

- **Phases completed:** 1/5
- **Requirements completed:** 2/11 (DB-01 ✓, DB-02 ✓ — both fully shipped: 01-02 primary path + 01-03 backfill tooling)
- **Tests added (this milestone):** 0 (baseline: 186 Vitest tests on `ilm-v2-reformulation`; note: counts have drifted — current server workspace is 1046 tests across 193 files)
- **Migrations added (this milestone):** 1 (0066_cost_events_heartbeat_run_set_null.sql) — latest baseline now `0066`, count 67
- **Incidents resolved:** 2026-04-23 overnight run ($38 bled, 25+ orphan issues, soft-deleted legacy company) — tracked as root causes for this milestone.

### Plan execution log

| Plan | Duration | Tasks | Files changed | Migrations | Outcome |
|------|----------|-------|---------------|------------|---------|
| 01-01 | ~90 min | 3/3 | 9 | 1 | DB-01 complete — FK set null schema+DB, handler reorder, seed-fallback DELETE=200 |
| 01-02 | ~22 min | 3/3 | 2 | 0 | DB-02 complete — cloneNextInboxIssue routes through issueService.create; verifier exits ok:true with delta=1, non-null projectId+identifier |
| 01-03 | ~18 min | 2/2 | 2 | 0 | DB-02 backfill tool — scripts/backfill-issue-metadata.ts idempotent + --dry-run; counter-stable 43→43→43 across apply + re-run; 0 orphans remaining. Phase 1 DONE. |

## Accumulated Context

### Key Decisions Carried from PROJECT.md

- Branch `ilm-v2-reformulation` stays the ILM operational branch (not upstream `main`) — carries Windows patches + v2 lifecycle + orchestrator.
- Soft delete (`PATCH status=archived`) was used as a workaround for the legacy ILM v1 company delete 500. DB-01 in Phase 1 fixes the root cause (plan 01-01 complete).
- Budget cap `BUDGET_USD_CAP=50` exists but did not short-circuit the retry loop — fix is ORCH-03 in Phase 2 (per-transition accounting BEFORE Claude invocation).
- Coarse granularity + YOLO mode + research off — codebase map (`.planning/codebase/`) already covers the 8 known bugs.

### Decisions from Plan 01-01 (DB-01)

- D-01 implemented: `cost_events.heartbeat_run_id` FK uses `onDelete: "set null"` (not cascade) to preserve cost-history audit rows when heartbeat_runs are pruned.
- D-02 implemented: `companyService.remove` now explicitly prunes `cost_events` before `heartbeat_runs` inside the same transaction — belt-and-braces defense on top of the schema FK.
- D-05 implemented: migration 0066 was generated via drizzle-kit (DROP+ADD constraint statements are verbatim from its output); unrelated drift from prior hand-written migrations (0063-0065) was trimmed out before commit.
- Deviation: plan step 5 primary path (curl DELETE f0c2b690 → 200) was blocked by two pre-existing handler FK-ordering bugs (`projects_goal_id_goals_id_fk`, missing `document_revisions` prune) that are outside DB-01 scope. Used the plan-endorsed seed-fallback (step 5c) + in-process fallback (step 5e) to prove the FK cascade end-to-end on a minimal seeded company. HTTP_STATUS_EQUIVALENT=200 achieved. Deferred bugs logged at `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md`.

### Decisions from Plan 01-02 (DB-02)

- D-03 implemented: `packages/db/orchestrate-e2e.ts::cloneNextInboxIssue` now calls `issueService(db).create(...)` (primary path via relative import from `../../server/src/services/issues.js`) instead of the raw `sql\`INSERT INTO issues ...\``. No workspace dep edge added — the script was already installation-specific.
- D-04 respected: NO Postgres `NOT NULL CHECK` constraint added on `issues.project_id` or `issues.identifier` in this phase.
- Field adjustment: dropped `lifecycleState` from the service call — the column was added via raw migration 0065, is not exposed in the Drizzle schema, and defaults to 'inbox' at the DB level. Zero behavior change.
- Path taken was the primary (service import), NOT the HTTP fallback. Server + db typechecks green, import-resolution smoke test clean.
- SC-3 gate at integration level: `scripts/_verify-orchestrator-create-path.ts` created — a dry-stub verifier that invokes the refactored createIssue path once (no Claude, no CEO spec step) and SQL-asserts project_id + identifier non-null + counter delta=1. Exit 0 with `{ ok: true, delta: 1, identifier: "ILV2-42", ... }`. Full orchestrator-loop coverage remains owned by Phase 4 TEST-02.
- Task 2 deviation: `pnpm --filter @paperclipai/server test:run` script does not exist in this repo. Adapted to run `pnpm exec vitest run` inside each workspace directly; the 4 named ILM-v2 suites (dispatcher, lifecycle, handoff, budget-guard) all pass 21/21. The 53 failures observed in the full server run are pre-existing embedded-postgres startup timeouts, unrelated to this plan (no server test imports orchestrate-e2e.ts).

### Todos / Watchlist

- [x] Phase 1: Write drizzle migration for `cost_events.heartbeat_run_id onDelete` (DB-01) — done in plan 01-01 (commit 19b12a0d + ddfa9a02).
- [x] Phase 1: Replace raw `sql\`INSERT INTO issues...\`` in `packages/db/orchestrate-e2e.ts:391-408` with `createIssue` service call (DB-02) — done in plan 01-02 (commit dc95f793 + aed28e64).
- [x] Phase 1: Idempotent backfill script `scripts/backfill-issue-metadata.ts` promoted from `scripts/_fix-orphans.ts` (DB-02 support) — done in plan 01-03 (commits aca28fb1 + b5ab727b).
- [ ] Phase 1 (deferred): Full `companyService.remove` FK-chain audit — reorder goals/projects, add document_revisions prune. See `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md`. Carried forward to Phase 4 TEST-02 or a Phase 1 bonus.
- [ ] Phase 1 (optional cleanup): Delete 2 `verify-p01-02-*` noise rows left by the 01-02 dry-stub verifier — counter auto-corrects on next real orchestrator call.
- [ ] Phase 2: Refactor `processIssue` into an explicit FSM `stepFrom(state, issue)` (ORCH-01, sets up TEST-02).
- [ ] Phase 3: Add Zod entry-point validation on 4 routes that currently 500 on malformed bodies (API-01).
- [ ] Phase 4: Create `packages/adapters/pi-local/src/server/execute.test.ts` + `packages/adapters/codex-local/src/server/codex-home.test.ts` (TEST-01).

### Known Blockers

- None currently. Codebase map is fresh (2026-04-23). Branch `ilm-v2-reformulation` is pushed to fork. Embedded Postgres is patched and booting.

### Risks to Monitor

- **Windows patch regression:** Any `pnpm update` of `codex-local` or `pi-local` can drop the symlink / arg-limit fallbacks silently. Phase 4's TEST-01 + CI guard is the mitigation.
- **Migration drift:** DB-01 adds a migration; if the drizzle journal gets out of sync, `reconcilePendingMigrationHistory()` in `packages/db/src/client.ts` can repair but must be verified after Phase 1.
- **Claude-in-loop cost:** Until Phase 2 lands, do NOT re-run `packages/db/orchestrate-e2e.ts` against real Opus without manually checking `spend_today` — the $38 bleed can recur.
- **embedded-postgres beta dependency:** `patches/embedded-postgres@18.1.0-beta.16.patch` is vendored; keep an eye on upstream for a stable release.

## Session Continuity

### Last Session

- **2026-04-23 (late evening):** Executed plan 01-03 (DB-02 backfill tooling). 2 tasks, 2 commits (aca28fb1, b5ab727b). `scripts/backfill-issue-metadata.ts` promoted from `scripts/_fix-orphans.ts`: header doc (Usage/Env/Idempotency/Reversibility), `--dry-run` flag, name-based project lookup (no stale UUID), belt-and-braces `AND identifier IS NULL` inner-UPDATE guard, structured JSON report. Idempotency proven empirically: counter probe captured 43 → 43 → 43 across apply + re-run (Δ=0, no double-increment). Final orphan count = 0. Phase 1 now 3/3 complete — both DB-01 and DB-02 fully shipped.
- **2026-04-23 (evening):** Executed plan 01-02 (DB-02). 3 tasks, 2 commits (dc95f793, aed28e64). `packages/db/orchestrate-e2e.ts::cloneNextInboxIssue` now calls `issueService(db).create(...)` instead of raw SQL INSERT. Server + db typechecks green. ILM-v2 vitest regression floor 21/21 green. Dry-stub verifier `scripts/_verify-orchestrator-create-path.ts` exits 0 with `{ok: true, delta: 1, identifier: "ILV2-42"}`. Discovered that `lifecycleState` is not in the Drizzle schema (raw-migration-only column) and dropped it from the service call — DB default preserves the behavior. Also noted that `pnpm --filter @paperclipai/server test:run` script does not exist; used direct `pnpm exec vitest run` per workspace.
- **2026-04-23 (afternoon):** Executed plan 01-01 (DB-01). 3 tasks, 3 commits (19b12a0d, d0079a1c, ddfa9a02). Schema FK set null applied, migration 0066 applied live, pg_constraint verified, seed-fallback end-to-end DELETE reproduction exited 0 with HTTP_STATUS_EQUIVALENT=200. Discovered two pre-existing handler bugs (goals/projects order, missing document_revisions prune) and deferred them to `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md` since they're outside DB-01 scope.
- **2026-04-23 (morning):** Initial GSD setup. Ran `/gsd-map-codebase` → produced `.planning/codebase/` (7 docs, 2097 lines). Ran `/gsd-new-project` → PROJECT.md + REQUIREMENTS.md authored. Roadmap created and Phase 1 planned.
- **2026-04-23 (overnight prior):** Paperclip overnight orchestrator bled ~$38 in `pr_open → spec_d` retry loop. 25+ orphan issues backfilled manually via SQL. Legacy `ILM` v1 company soft-deleted (hard DELETE 500'd on FK cascade). Branch pushed to `adya-tupinamba/paperclip` fork.

### Next Session — Start Here

1. Phase 1 is COMPLETE (3/3 plans, DB-01 + DB-02 shipped). Run `/gsd-transition` to close out Phase 1 and kick off Phase 2 planning (orchestrator bleed-stopper — ORCH-01/02/03), OR run `/gsd-plan-phase 2` directly.
2. Phase 2 opens with ORCH-01 (resume respects `lifecycle_state`) as the foundational plan; ORCH-02 and ORCH-03 build on the FSM entry point ORCH-01 introduces.
3. Optional cleanups (low priority):
   - `DELETE FROM issues WHERE origin_fingerprint LIKE 'verify-p01-02-%';` — 2 noise rows from 01-02's dry-stub verifier (counter auto-corrects on next real orchestrator call).
   - Phase 1 bonus plan: FK-chain audit of `companyService.remove` (goals/projects order + document_revisions prune) — see `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md`.
4. Risk to watch before Phase 2: until ORCH-03's budget circuit breaker lands, do NOT re-run `packages/db/orchestrate-e2e.ts` against real Claude Opus without manually checking `spend_today` — the $38 bleed can recur.

### Open Questions

- None at roadmap creation. Coverage is 100%, no orphaned requirements.

## Milestone Progress Snapshot

| Phase | Name | Status | Requirements | Plans |
|-------|------|--------|--------------|-------|
| 1 | Schema & data-integrity foundation | **Complete (3/3 plans)** | DB-01 ✓, DB-02 ✓ | 01-01 ✓, 01-02 ✓, 01-03 ✓ |
| 2 | Orchestrator bleed-stopper | Not started | ORCH-01, ORCH-02, ORCH-03 | TBD |
| 3 | API hardening & workspace interpolation | Not started | API-01, API-02, EXEC-01 | TBD |
| 4 | Test safety net | Not started | TEST-01, TEST-02 | TBD |
| 5 | Operator recovery playbook | Not started | OPS-01 | TBD |

**Coverage:** 11/11 requirements mapped ✓

---

*This file is updated at every phase transition (via `/gsd-transition`) and at milestone boundary (via `/gsd-complete-milestone`).*
