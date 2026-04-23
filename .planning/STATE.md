# STATE — Paperclip v1.0 (overnight reliability)

**Last updated:** 2026-04-23 (roadmap created)

## Project Reference

- **Project:** Paperclip — self-hosted AI agent orchestration platform for ILM ops
- **Milestone:** v1.0 — Fix paperclip v2 bugs (overnight reliability)
- **Core value:** The overnight orchestrator (`packages/db/orchestrate-e2e.ts`) must reliably drive issues through the 11-state lifecycle without infinite-looping, silently burning budget, or corrupting metadata.
- **Current focus:** Phase 1 — Schema & data-integrity foundation (not started).

## Current Position

- **Phase:** 1 of 5 — Schema & data-integrity foundation
- **Plan:** None yet (plans TBD — run `/gsd-plan-phase 1` to decompose)
- **Status:** Not started
- **Overall progress:** `[░░░░░░░░░░] 0/5 phases complete`
- **Requirements progress:** `[░░░░░░░░░░░] 0/11 requirements complete`

## Performance Metrics

- **Phases completed:** 0/5
- **Requirements completed:** 0/11
- **Tests added (this milestone):** 0 (baseline: 186 Vitest tests on `ilm-v2-reformulation`)
- **Migrations added (this milestone):** 0 (baseline: 66 migrations; latest `0065_ilm_v2_lifecycle.sql`)
- **Incidents resolved:** 2026-04-23 overnight run ($38 bled, 25+ orphan issues, soft-deleted legacy company) — tracked as root causes for this milestone.

## Accumulated Context

### Key Decisions Carried from PROJECT.md

- Branch `ilm-v2-reformulation` stays the ILM operational branch (not upstream `main`) — carries Windows patches + v2 lifecycle + orchestrator.
- Soft delete (`PATCH status=archived`) was used as a workaround for the legacy ILM v1 company delete 500. DB-01 in Phase 1 fixes the root cause.
- Budget cap `BUDGET_USD_CAP=50` exists but did not short-circuit the retry loop — fix is ORCH-03 in Phase 2 (per-transition accounting BEFORE Claude invocation).
- Coarse granularity + YOLO mode + research off — codebase map (`.planning/codebase/`) already covers the 8 known bugs.

### Todos / Watchlist (not yet started)

- [ ] Phase 1: Write drizzle migration for `cost_events.heartbeat_run_id onDelete` (DB-01).
- [ ] Phase 1: Replace raw `sql\`INSERT INTO issues...\`` in `packages/db/orchestrate-e2e.ts:391-408` with `createIssue` service call (DB-02).
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

- **2026-04-23 (morning):** Initial GSD setup. Ran `/gsd-map-codebase` → produced `.planning/codebase/` (7 docs, 2097 lines). Ran `/gsd-new-project` → PROJECT.md + REQUIREMENTS.md authored. Roadmap created now.
- **2026-04-23 (overnight prior):** Paperclip overnight orchestrator bled ~$38 in `pr_open → spec_d` retry loop. 25+ orphan issues backfilled manually via SQL. Legacy `ILM` v1 company soft-deleted (hard DELETE 500'd on FK cascade). Branch pushed to `adya-tupinamba/paperclip` fork.

### Next Session — Start Here

1. Review `.planning/ROADMAP.md` — confirm the 5-phase structure matches intent.
2. Run `/gsd-plan-phase 1` to decompose Phase 1 (DB-01, DB-02) into plans.
3. Alternatively, if urgent: Phase 2 (ORCH bugs) is the bleed-stopper — could be prioritized, but Phase 1 is prerequisite-like for DB-02's service-layer refactor.

### Open Questions

- None at roadmap creation. Coverage is 100%, no orphaned requirements.

## Milestone Progress Snapshot

| Phase | Name | Status | Requirements | Plans |
|-------|------|--------|--------------|-------|
| 1 | Schema & data-integrity foundation | Not started | DB-01, DB-02 | TBD |
| 2 | Orchestrator bleed-stopper | Not started | ORCH-01, ORCH-02, ORCH-03 | TBD |
| 3 | API hardening & workspace interpolation | Not started | API-01, API-02, EXEC-01 | TBD |
| 4 | Test safety net | Not started | TEST-01, TEST-02 | TBD |
| 5 | Operator recovery playbook | Not started | OPS-01 | TBD |

**Coverage:** 11/11 requirements mapped ✓

---

*This file is updated at every phase transition (via `/gsd-transition`) and at milestone boundary (via `/gsd-complete-milestone`).*
