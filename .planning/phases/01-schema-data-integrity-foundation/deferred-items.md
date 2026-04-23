# Deferred Items — Phase 01 Schema & Data-Integrity Foundation

Discovered during plan execution, out of scope for the current plan. Logged for future planner consumption.

---

## DB-01 / Plan 01-01 discovery (2026-04-23)

### Pre-existing bug: `companyService.remove` deletes goals BEFORE projects

**File:** `server/src/services/companies.ts:285-286`

**Problem:** `projects.goal_id` references `goals.id` with default NO ACTION (see `packages/db/src/schema/projects.ts:12`). The current `remove()` transaction deletes goals first, then projects, so any company with a project that has a non-null goal_id will 23503 on `projects_goal_id_goals_id_fk`.

**Surfaced:** During DB-01 Task 3 step 5 end-to-end DELETE reproduction against company `f0c2b690-0bad-4421-8043-2f4a328df440`. After the DB-01 FK fix resolved the original `cost_events_heartbeat_run_id_heartbeat_runs_id_fk` 500, this 23503 became the new terminal error on HTTP DELETE.

**Fix sketch:** Swap the two `tx.delete(...)` statements so projects is pruned before goals. Apply the same T-01-05-style regression gate (`grep -c 'companyId, id'`).

**Why deferred:** Outside DB-01 scope (Task 2 reorder target was `costEvents` vs `heartbeatRuns`, not `projects` vs `goals`). A separate follow-up plan should audit every child-table FK chain in `companyService.remove` and derive a correct topological ordering once.

---

### Pre-existing bug: `companyService.remove` does not prune `document_revisions`

**File:** `server/src/services/companies.ts:260-293`

**Problem:** `document_revisions.company_id` references `companies.id` (default NO ACTION) but the `remove()` transaction has no `tx.delete(documentRevisions)` step. Deleting the companies row 23503s with `document_revisions_company_id_companies_id_fk`.

**Surfaced:** During in-process DELETE attempt against f0c2b690 (after the goals/projects reorder workaround was tried, then reverted).

**Fix sketch:** Add `await tx.delete(documentRevisions).where(eq(documentRevisions.companyId, id));` to the transaction, before the final `tx.delete(companies)`. Also add the `documentRevisions` import at the top of the file. Apply T-01-05 regression gate (`grep -c 'companyId, id'` should go up by exactly 1).

**Why deferred:** Same scope reason — outside DB-01. Part of the same broader audit.

---

### Recommended follow-up: full `companyService.remove` FK-chain audit

The two bugs above suggest the `remove()` handler was authored without a systematic FK-topology check. A proper fix is:

1. Enumerate every table with a `company_id` FK to `companies` (grep across `packages/db/src/schema/*.ts`).
2. Build a DAG of inter-table FKs within that set.
3. Emit the deletion sequence as a reverse-topological sort.
4. Add a vitest integration test that seeds a minimal company touching every referenced table, then DELETEs and asserts 200.

This becomes a candidate requirement for Phase 4 (TEST-02 test safety net) or an opportunistic Phase 1 bonus plan if scheduling allows.

---

*Logged by plan 01-01 executor on 2026-04-23.*
