# Phase 1: Schema & data-integrity foundation — Context

**Gathered:** 2026-04-23 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix two data-integrity foundations so the rest of the milestone can build on them:

1. **DB-01** — `DELETE /api/companies/:id` succeeds for companies with prior `heartbeat_runs` + attached `cost_events`. Today the FK `cost_events_heartbeat_run_id_heartbeat_runs_id_fk` has no `onDelete` clause (defaults to `NO ACTION`) so deletion 500s at the Postgres layer.
2. **DB-02** — Every INSERT into `issues` commits with non-null `project_id` and `identifier`. Today the overnight orchestrator bypasses `server/src/services/issues.ts::createIssue` with raw SQL, producing the 25-row orphan batch observed on 2026-04-23.

In scope:
- Schema change to `cost_events.heartbeat_run_id` FK declaration
- A new drizzle migration in `packages/db/src/migrations/`
- Defense-in-depth explicit prune in `server/src/routes/companies.ts` DELETE handler
- Refactor `packages/db/orchestrate-e2e.ts` issue-creation path to call `issueService.createIssue`
- Backfill SQL for any remaining null `project_id`/`identifier` rows (idempotent, promotable from the one-off 2026-04-23 script)

Out of scope (other phases):
- Budget circuit breaker and state-machine resume (Phase 2 — ORCH-*)
- Zod schema validation at route entry (Phase 3 — API-*)
- Tests covering the fixes (Phase 4 — TEST-*)
- Postmortem runbook script (Phase 5 — OPS-01)

</domain>

<decisions>
## Implementation Decisions

### FK Cascade Behavior on `cost_events.heartbeat_run_id`

- **D-01:** Declare `heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" })` in `packages/db/src/schema/cost_events.ts:18`.
  - **Why `set null` over `cascade`:** Cost history is audit-valuable — an agent run being pruned should not erase the record that it spent $X. The sibling FK in `packages/db/src/schema/heartbeat_runs.ts:38` already uses `onDelete: "set null"`, so this restores symmetry documented in CONCERNS.md §1 ("confirming the asymmetry is accidental").
  - **Why not `restrict`:** Would still 500 the DELETE handler; defeats the purpose.
  - **Data handling:** Existing rows keep their `heartbeat_run_id` until the referenced run is deleted; at that point the row's `heartbeat_run_id` is nulled but the `company_id`, `cost_usd`, `timestamp`, and `metadata` remain intact.

### DELETE `/api/companies/:id` Handler Changes

- **D-02:** Belt-and-braces defense — the DELETE handler in `server/src/routes/companies.ts` explicitly prunes `cost_events` (and any other tables known to block delete) inside a transaction BEFORE calling the main company-delete cascade.
  - **Why:** Schema-level FK is the safety net; handler-level explicit prune is the primary defense. If a future migration forgets `onDelete`, the handler still works. If the handler is refactored, the FK still works. Pattern matches defense-in-depth elsewhere in `server/src/services/` (cross-referenced during `scout_codebase`).
  - **Transaction boundary:** Wrap the entire company-delete sequence in a single `db.transaction` so a partial failure rolls back — no half-deleted companies.

### Atomic Issue-Creation Enforcement

- **D-03:** Refactor `packages/db/orchestrate-e2e.ts` to call `server/src/services/issues.ts::createIssue` instead of issuing raw `sql\`INSERT INTO issues ...\`` (CONCERNS.md §6 root cause at `orchestrate-e2e.ts:391-408`).
  - **Why:** Single source of truth for the `companies.issue_counter` increment + identifier generation + project_id wiring. The service layer already exists and is used by the REST API; the orchestrator just needs to adopt it.
  - **Backfill strategy:** Promote the ad-hoc `_fix-orphans.ts` logic (that ran 2026-04-23 to assign ILV2-17..ILV2-41) into a reusable `scripts/backfill-issue-metadata.ts` that can be invoked idempotently. Run once after the orchestrator refactor to clean any rows still null. **This is a one-time fix tool, not the long-term runbook** — the long-term runbook (`scripts/postmortem-stuck-orchestrator.ts`) is scoped to Phase 5.

- **D-04:** Do NOT add a Postgres `NOT NULL` CHECK constraint on `issues.project_id` or `issues.identifier` in this phase.
  - **Why:** Existing orphan rows (even after backfill, any rows created in flight during the transition) would make the migration fail. Enforcement at the service layer + CI-grep check against raw `INSERT INTO issues` in `packages/db/` is sufficient for now. Adding the NOT NULL constraint becomes safe after Phase 4 test coverage proves the service-only path stays clean; candidate for v1.1 or a Phase 4 bonus.

### Migration Generation Approach

- **D-05:** Use `drizzle-kit generate` from the schema change to produce the migration file, following the pattern of the 65 existing migrations in `packages/db/src/migrations/` (per `.planning/codebase/CONVENTIONS.md` — migrations use `--> statement-breakpoint` separators, schema is source of truth).
  - **Why not hand-written raw SQL:** The repo convention is "schema file → generated migration"; hand-writing drifts from the TS types and breaks `drizzle-kit` verification on subsequent migrations.
  - **Migration number:** Will be `0066_cost_events_set_null_on_heartbeat_run.sql` (or similar per drizzle-kit naming).
  - **Verification:** `pnpm -C packages/db db:migrate` against a fresh embedded-postgres instance; `pnpm --filter @paperclipai/db exec tsx scripts/verify-migration.ts` (if this helper exists — otherwise a one-liner assert that querying the FK metadata shows `ON DELETE SET NULL`).

### Claude's Discretion

- Exact naming of helper functions (`pruneCompanyCostEvents`, `backfillIssueMetadata`, etc.) — planner can match the naming conventions from `.planning/codebase/CONVENTIONS.md`.
- Whether to add a small audit log row in the handler documenting what was pruned (e.g. N cost_events rows pruned during company X delete) — nice-to-have, skip if it complicates the transaction.
- Internal signature of `issueService.createIssue` — if it needs an extension for orchestrator context (e.g. `createdByOrchestrator: true` metadata flag), that's a planner call.
- Whether to run the backfill SQL in the migration itself or as a separate one-off script — planner decides based on how many null rows exist at migration time; safe default is separate script since running during migration delays `pnpm db:migrate`.

### Folded Todos

No todos folded (no `.planning/todos/pending/` entries at phase start).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bug context and root-cause evidence

- `.planning/codebase/CONCERNS.md` §1 — DELETE 500 with exact FK error, file refs, and fix recommendation
- `.planning/codebase/CONCERNS.md` §6 — orphan issues root cause at `orchestrate-e2e.ts:391-408`, backfill pattern from 2026-04-23

### Schema and migration pattern

- `packages/db/src/schema/cost_events.ts` — the file to edit (line 18 for the FK)
- `packages/db/src/schema/heartbeat_runs.ts` §38 — sibling FK that already uses `onDelete: "set null"` (precedent)
- `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql` — migration style reference (triggers, CHECK constraints, `statement-breakpoint` separators)
- `.planning/codebase/CONVENTIONS.md` — migration conventions, `createRequire` pattern for TS scripts hitting the DB

### Service layer and handler

- `server/src/services/issues.ts` (see `::createIssue` at line ~1862 per CONCERNS.md §6) — the canonical atomic create path the orchestrator must adopt
- `server/src/routes/companies.ts` — the DELETE handler to extend with explicit pre-cleanup
- `packages/db/orchestrate-e2e.ts:391-408` — the bypass site to refactor

### Existing ops scripts to supersede

- `C:\Users\ilm\Documents\GitHub\paperclip\scripts\_fix-orphans.ts` — ad-hoc 2026-04-23 script; its logic gets promoted to `scripts/backfill-issue-metadata.ts`
- `C:\Users\ilm\Documents\GitHub\paperclip\scripts\_seed-paperclip-fork-push-issue.ts` — reference for the atomic service-layer INSERT pattern via `sql.begin` transaction

### Higher-level context

- `.planning/PROJECT.md` — project vision, Core Value, key decisions
- `.planning/REQUIREMENTS.md` — DB-01, DB-02 full text
- `.planning/ROADMAP.md` — Phase 1 goal and 4 success criteria
- `.planning/codebase/ARCHITECTURE.md` — adapter/orchestrator/service layers
- `.planning/codebase/STRUCTURE.md` — pnpm workspace layout

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `server/src/services/issues.ts::createIssue` — atomic service that correctly increments `companies.issue_counter` and builds the `identifier` (`<prefix>-<n>`). The orchestrator refactor points all raw-INSERT call sites at this.
- `drizzle-kit` — already wired into `packages/db/package.json`. Schema → migration workflow is the norm.
- Sibling `heartbeat_runs.ts:38` shows the exact pattern (`onDelete: "set null"`) to mirror.
- `sql.begin(async (tx) => { ... })` transaction pattern used in `scripts/_seed-paperclip-fork-push-issue.ts` is the template for the belt-and-braces DELETE handler transaction.

### Established Patterns

- **Migrations are generated, not hand-written.** 65 existing migrations follow `drizzle-kit generate` → numbered `.sql` in `packages/db/src/migrations/` with `--> statement-breakpoint` separators.
- **Scripts anchor dependencies via `createRequire`** against `packages/db/package.json` — every one-off `scripts/*.ts` uses this pattern (see `scripts/run-ilm-project-workspaces.ts`). The new `scripts/backfill-issue-metadata.ts` follows suit.
- **Service layer owns identifier + counter logic.** Raw SQL inserts that bypass the service are the bug class this phase eliminates.

### Integration Points

- `server/src/routes/companies.ts` — DELETE handler connects to `server/src/services/companies.ts` (likely called `deleteCompany`). The explicit prune runs inside that service or immediately before it, inside the same transaction.
- `packages/db/orchestrate-e2e.ts` — the single file where the orchestrator creates issues. Currently at `orchestrate-e2e.ts:391-408` (per CONCERNS.md). After this phase it imports and calls `issueService.createIssue` instead.
- `packages/db/src/schema/cost_events.ts` — one-line change; drizzle-kit picks it up.

</code_context>

<specifics>
## Specific Ideas

- The FK fix must match the existing `onDelete: "set null"` on `heartbeat_runs` — keep schema symmetry explicit (CONCERNS.md §1 flags the current asymmetry as "accidental").
- The DELETE handler change should be visible and auditable — prefer explicit `await tx.delete(costEvents).where(eq(costEvents.companyId, id))` over relying solely on cascade magic. Future reviewers (and agents) can read the handler and understand what's deleted without cross-referencing schema files.
- Backfill script must be idempotent: running it twice should not double-increment `companies.issue_counter`. The 2026-04-23 one-off used `UPDATE companies SET issue_counter = issue_counter + 1 RETURNING` in a loop — safe to promote, but add a guard that only targets rows where `identifier IS NULL`.
- The orchestrator refactor is a surface change, not a behavior change — the existing orchestrator tests (in `server/src/__tests__/` ILM-v2 suite) should still pass after the refactor; if any break, their mocks need to move from the raw-SQL path to the service-mock path.

</specifics>

<deferred>
## Deferred Ideas

### For Phase 2 (Orchestrator bleed-stopper)
- Budget circuit breaker tied to the refactored `issueService.createIssue` call site — Phase 2 can intercept spend estimation here.
- `stepFrom(state, issue)` FSM entry point — Phase 2 will need it; Phase 1 leaves the orchestrator structurally ready (service layer adoption reduces orchestrator LOC so Phase 2's refactor is smaller).

### For Phase 4 (Test safety net)
- Integration test that reproduces the 2026-04-23 DELETE-500 case exactly: seed a company with heartbeat_runs + cost_events, assert `DELETE /api/companies/:id` returns 200 and that cost_events rows are gone (or nulled per D-01).
- Assertion that `grep -rE "INSERT INTO issues" packages/db/ server/src/` returns only the service-layer file — CI guard catching future bypass.
- Consider elevating `NOT NULL` CHECK on `issues.project_id` and `issues.identifier` once service-only path is proven — deliberately deferred from this phase (see D-04).

### For Phase 5 (Operator recovery playbook)
- `scripts/backfill-issue-metadata.ts` (created in this phase as a one-off tool) becomes one of the utilities the larger `scripts/postmortem-stuck-orchestrator.ts` runbook invokes.

### Reviewed Todos (not folded)

None — no pending todos at phase start.

</deferred>

---

*Phase: 01-schema-data-integrity-foundation*
*Context gathered: 2026-04-23*
