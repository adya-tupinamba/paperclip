# STATE — Paperclip v1.0 (overnight reliability)

**Last updated:** 2026-04-23 (plan 01-01 complete)

## Project Reference

- **Project:** Paperclip — self-hosted AI agent orchestration platform for ILM ops
- **Milestone:** v1.0 — Fix paperclip v2 bugs (overnight reliability)
- **Core value:** The overnight orchestrator (`packages/db/orchestrate-e2e.ts`) must reliably drive issues through the 11-state lifecycle without infinite-looping, silently burning budget, or corrupting metadata.
- **Current focus:** Phase 1 — Schema & data-integrity foundation (not started).

## Current Position

- **Phase:** 1 of 5 — Schema & data-integrity foundation
- **Plan:** 01-01 complete; 01-02 next (DB-02 atomic issue creation, wave 1)
- **Status:** In progress (1/3 plans complete in Phase 1)
- **Overall progress:** `[░░░░░░░░░░] 0/5 phases complete`
- **Requirements progress:** `[█░░░░░░░░░░] 1/11 requirements complete`

## Performance Metrics

- **Phases completed:** 0/5
- **Requirements completed:** 1/11 (DB-01 ✓)
- **Tests added (this milestone):** 0 (baseline: 186 Vitest tests on `ilm-v2-reformulation`)
- **Migrations added (this milestone):** 1 (0066_cost_events_heartbeat_run_set_null.sql) — latest baseline now `0066`, count 67
- **Incidents resolved:** 2026-04-23 overnight run ($38 bled, 25+ orphan issues, soft-deleted legacy company) — tracked as root causes for this milestone.

### Plan execution log

| Plan | Duration | Tasks | Files changed | Migrations | Outcome |
|------|----------|-------|---------------|------------|---------|
| 01-01 | ~90 min | 3/3 | 9 | 1 | DB-01 complete — FK set null schema+DB, handler reorder, seed-fallback DELETE=200 |

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

### Todos / Watchlist

- [x] Phase 1: Write drizzle migration for `cost_events.heartbeat_run_id onDelete` (DB-01) — done in plan 01-01 (commit 19b12a0d + ddfa9a02).
- [ ] Phase 1: Replace raw `sql\`INSERT INTO issues...\`` in `packages/db/orchestrate-e2e.ts:391-408` with `createIssue` service call (DB-02) — plan 01-02.
- [ ] Phase 1 (deferred): Full `companyService.remove` FK-chain audit — reorder goals/projects, add document_revisions prune. See `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md`.
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

- **2026-04-23 (afternoon):** Executed plan 01-01 (DB-01). 3 tasks, 3 commits (19b12a0d, d0079a1c, ddfa9a02). Schema FK set null applied, migration 0066 applied live, pg_constraint verified, seed-fallback end-to-end DELETE reproduction exited 0 with HTTP_STATUS_EQUIVALENT=200. Discovered two pre-existing handler bugs (goals/projects order, missing document_revisions prune) and deferred them to `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md` since they're outside DB-01 scope.
- **2026-04-23 (morning):** Initial GSD setup. Ran `/gsd-map-codebase` → produced `.planning/codebase/` (7 docs, 2097 lines). Ran `/gsd-new-project` → PROJECT.md + REQUIREMENTS.md authored. Roadmap created and Phase 1 planned.
- **2026-04-23 (overnight prior):** Paperclip overnight orchestrator bled ~$38 in `pr_open → spec_d` retry loop. 25+ orphan issues backfilled manually via SQL. Legacy `ILM` v1 company soft-deleted (hard DELETE 500'd on FK cascade). Branch pushed to `adya-tupinamba/paperclip` fork.

### Next Session — Start Here

1. Execute plan 01-02 (DB-02) — refactor `packages/db/orchestrate-e2e.ts:391-408` to call `issueService.createIssue` instead of raw SQL insert.
2. Wave 2 after 01-02 lands: plan 01-03 (idempotent backfill-issue-metadata.ts).
3. Review deferred items for a potential Phase 1 bonus plan: FK-chain audit of `companyService.remove`.

### Open Questions

- None at roadmap creation. Coverage is 100%, no orphaned requirements.

## Milestone Progress Snapshot

| Phase | Name | Status | Requirements | Plans |
|-------|------|--------|--------------|-------|
| 1 | Schema & data-integrity foundation | In progress (1/3 plans) | DB-01 ✓, DB-02 | 01-01 done, 01-02 next, 01-03 wave 2 |
| 2 | Orchestrator bleed-stopper | Not started | ORCH-01, ORCH-02, ORCH-03 | TBD |
| 3 | API hardening & workspace interpolation | Not started | API-01, API-02, EXEC-01 | TBD |
| 4 | Test safety net | Not started | TEST-01, TEST-02 | TBD |
| 5 | Operator recovery playbook | Not started | OPS-01 | TBD |

**Coverage:** 11/11 requirements mapped ✓

---

*This file is updated at every phase transition (via `/gsd-transition`) and at milestone boundary (via `/gsd-complete-milestone`).*
