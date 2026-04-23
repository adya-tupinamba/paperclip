# Phase 1: Schema & data-integrity foundation — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 01-schema-data-integrity-foundation
**Mode:** `--auto` (recommended options selected without interactive prompting)
**Areas discussed:** FK Cascade Behavior, DELETE Handler Defense Depth, Atomic Issue-Creation Enforcement, Migration Generation Approach

---

## FK Cascade Behavior (on `cost_events.heartbeat_run_id`)

| Option | Description | Selected |
|--------|-------------|----------|
| `onDelete: "set null"` | Preserve cost history when the referenced heartbeat_run is pruned; null out the FK. Mirrors the symmetric FK in `heartbeat_runs.ts:38`. | ✓ |
| `onDelete: "cascade"` | Align with "company deletion" intent — delete cost_events rows when their heartbeat_run is deleted. | |
| `onDelete: "restrict"` | Force explicit cleanup before delete; still 500s the DELETE handler. | |

**Auto-selected:** `onDelete: "set null"` (recommended — audit value of cost history + schema symmetry with sibling FK)
**Notes:** CONCERNS.md §1 explicitly flags the current asymmetry as "accidental." Restoring symmetry is the minimum-surprise fix; `cascade` would be a legitimate choice if ILM wanted to discard cost history with the company, but `set null` preserves it for future billing review.

---

## DELETE Handler Defense Depth

| Option | Description | Selected |
|--------|-------------|----------|
| FK cascade alone | Rely on the schema-level FK change from D-01 to handle cleanup. | |
| Manual prune in handler | Explicit `db.delete(costEvents).where(...)` inside a transaction before the company delete. | |
| Both (belt-and-braces) | Explicit prune is primary defense; FK is safety net. Both present. | ✓ |

**Auto-selected:** Both (recommended — defense-in-depth; matches paperclip's layered service pattern).
**Notes:** If a future migration drops `onDelete`, the handler still works. If someone refactors the handler, the FK still works. The cost of this is a ~3-line addition inside the company-delete transaction.

---

## Atomic Issue-Creation Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Refactor orchestrator to call `issueService.createIssue` | Service layer becomes single source of truth for counter + identifier wiring. | ✓ |
| Add DB trigger enforcing `NOT NULL` on project_id/identifier | Schema-level enforcement. | |
| Both (refactor + trigger) | Maximum enforcement. | |
| `NOT NULL` CHECK constraint via migration | Block inserts at the column level. | |

**Auto-selected:** Refactor orchestrator to call `issueService.createIssue` (recommended — matches existing service pattern; single source of truth).
**Notes:** `NOT NULL` CHECK constraint is deferred to v1.1 because any in-flight orphan rows during the transition would break the migration. A CI grep guard against `INSERT INTO issues` in `packages/db/` provides sufficient guardrail until Phase 4 tests prove the service-only path stays clean.

---

## Migration Generation Approach

| Option | Description | Selected |
|--------|-------------|----------|
| `drizzle-kit generate` from schema | Matches the pattern of 65 existing migrations; schema is source of truth. | ✓ |
| Hand-written raw SQL | Faster to write for a single-column change; risks drift from TS schema types. | |
| Raw SQL + schema comment reference | Document the intent inline. | |

**Auto-selected:** `drizzle-kit generate` (recommended — matches existing migration conventions from `.planning/codebase/CONVENTIONS.md`).
**Notes:** Generating via drizzle-kit keeps the schema TS file as the source of truth and preserves `pnpm -C packages/db db:migrate` as the single entry point. Hand-writing would break subsequent drizzle-kit verification.

---

## Claude's Discretion

The following were left to the planner's discretion (not auto-decided here):
- Exact naming of helper functions (`pruneCompanyCostEvents`, `backfillIssueMetadata`, etc.)
- Whether to add an audit log row for the pruned cost_events count
- Internal signature extensions of `issueService.createIssue` for orchestrator metadata
- Whether the backfill runs in the migration itself or as a separate `scripts/backfill-issue-metadata.ts` (safe default: separate script)

## Deferred Ideas

- Budget circuit breaker integration point inside `issueService.createIssue` → Phase 2 (ORCH-03)
- FSM entry point `stepFrom(state, issue)` → Phase 2 (ORCH-01/02)
- End-to-end DELETE-500 regression test reproducing the 2026-04-23 case on `f0c2b690` → Phase 4 (TEST-02)
- `grep -rE "INSERT INTO issues"` CI guard → Phase 4 (TEST-01 equivalent)
- `NOT NULL` CHECK constraint upgrade once service-only path is proven → v1.1
- Promoting `scripts/_fix-orphans.ts` logic into the larger `scripts/postmortem-stuck-orchestrator.ts` runbook → Phase 5 (OPS-01)

---

*End of discussion log.*
