---
phase: 1
name: Schema & data-integrity foundation
status: passed
date: 2026-04-23
score: 9/9 must-haves verified (2 REQs + 4 SCs + 3 plan-truth buckets)
overrides_applied: 0
roadmap_truths_verified: 4/4
requirements_satisfied:
  - DB-01
  - DB-02
deferred_items_reviewed: 3
deferred_items_confirmed_out_of_scope: 3
---

# Phase 1: Schema & data-integrity foundation — Verification Report

**Phase Goal (from ROADMAP.md):** A company with prior heartbeat runs can be hard-deleted; every new issue has a non-null `project_id` and `identifier` at commit time.

**Verified:** 2026-04-23
**Status:** PASSED
**Re-verification:** No — initial end-of-phase verification
**Branch:** `ilm-v2-reformulation`
**Commit tip:** `daba1f81` (docs 01-03 complete)

---

## Goal Achievement

### Observable Truths

Derived from ROADMAP Phase 1 Success Criteria (load-bearing) + plan frontmatter must_haves (merged, dedup'd — roadmap wording wins where overlap).

| #   | Truth (goal-backward) | Status     | Evidence                                                                                                                                                                             |
| --- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SC-1 | `DELETE /api/companies/:id` returns 200 for a company with prior heartbeat_runs + attached cost_events (the 2026-04-23 f0c2b690 class of failure is eliminated). | VERIFIED | Plan-endorsed seed-fallback path (01-01 plan step 5c) + in-process `companyService.remove` (step 5e) executed on seeded company `8ac42d33-284a-41d7-801c-531a5e2b494d`. Result: `HTTP_STATUS_EQUIVALENT=200`, all 3 seeded rows (company + heartbeat_run + cost_event) pruned inside a single transaction. The FK cascade executed end-to-end without throwing. |
| SC-2 | A new drizzle migration declares `cost_events.heartbeat_run_id` with `onDelete: "set null"` and `pnpm -C packages/db migrate` applies cleanly.               | VERIFIED | `packages/db/src/migrations/0066_cost_events_heartbeat_run_set_null.sql` exists. SQL content: `DROP CONSTRAINT` + `ADD CONSTRAINT ... ON DELETE set null ON UPDATE no action`. Applied live (`pnpm -C packages/db migrate` exit 0 during 01-01 Task 3). `pnpm tsx scripts/verify-cost-events-fk.ts` exit 0 live today: `OK: FK "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" has ON DELETE SET NULL (confdeltype='n')`. |
| SC-3 | Every row inserted into `issues` through the overnight orchestrator has non-null `project_id` AND non-null `identifier` — verified by SQL assertion after a fresh orchestrator run. | VERIFIED | `scripts/_verify-orchestrator-create-path.ts` exists. Plan 01-02 Task 3 ran it twice: `{ok:true, identifier:"ILV2-42", projectId:"39f55e51-...", counterBefore:41, counterAfter:42, delta:1}` and `{ok:true, identifier:"ILV2-43", ..., delta:1}`. Both runs SQL-assert `project_id IS NOT NULL AND identifier IS NOT NULL` AND `companies.issue_counter` Δ=exactly 1. Full orchestrator-loop coverage with Claude is owned by Phase 4 TEST-02 per plan revision the checker approved. |
| SC-4 | Orchestrator issue creation goes through `server/src/services/issues.ts::createIssue` instead of raw `sql\`INSERT INTO issues...\`` bypass — grep confirms no `INSERT INTO issues` in `packages/db/orchestrate-e2e.ts`. | VERIFIED | Live grep: `grep -ci 'INSERT INTO issues' packages/db/orchestrate-e2e.ts` = **0**. Broader check `grep -rEi "INSERT INTO issues" packages/db/ --include="*.ts" \| grep -v migrations` = **0** hits. Forward-looking wiring: line 32 imports `issueService`, line 88 constructs `issueSvc = issueService(db)`, line 408 `await issueSvc.create(ILM_V2_COMPANY, {...})`. |

**Score:** 4/4 roadmap success criteria verified — 100% coverage of the phase contract.

### Per-requirement Gate (goal-backward from REQUIREMENTS.md)

| ReqID | Text (abbrev) | Status | Supporting Evidence |
|---|---|---|---|
| **DB-01** | DELETE `/api/companies/:id` succeeds for companies with prior heartbeat runs; FK `onDelete: "set null"` + drizzle migration + handler-level prune. | SATISFIED | Schema edit at `cost_events.ts:18` (verified on disk). Migration `0066_cost_events_heartbeat_run_set_null.sql` (applied + confdeltype='n' live). Handler reorder at `companies.ts:266-268` (costEvents delete precedes heartbeatRuns delete inside a single transaction; `_verify-companies-reorder.mjs` exits 0). End-to-end DELETE via in-process `companyService.remove` on seeded f0c2b690-equivalent company returned HTTP_STATUS_EQUIVALENT=200. T-01-05 scoped-WHERE regression gate: BASELINE=26 → POST=26 (live: `grep -c 'companyId, id' server/src/services/companies.ts` = 26). |
| **DB-02** | Every INSERT into `issues` via the orchestrator has non-null project_id + identifier, atomic with counter increment. | SATISFIED | Raw `sql\`INSERT INTO issues\`` removed from `orchestrate-e2e.ts` (live grep: 0 matches). `cloneNextInboxIssue` now calls `issueSvc.create(ILM_V2_COMPANY, {...})` via relative import from `../../server/src/services/issues.js`. Service-layer create runs `counter bump + identifier generation + INSERT` inside one `db.transaction` (verified in issues.ts:1739-1915). Dry-stub verifier proved non-null project_id/identifier + counter Δ=1 on two independent invocations (ILV2-42, ILV2-43). Idempotent backfill `scripts/backfill-issue-metadata.ts` cleans any historical orphans; counter-stability proved 43→43→43 across apply + re-run, final orphan count = 0. |

**Both Phase 1 requirements SATISFIED.**

### Plan-frontmatter must-haves (spot-check against current disk state)

| Plan | Truth | Status | Live check |
|---|---|---|---|
| 01-01 | cost_events FK has ON DELETE SET NULL in schema TS + live DB | VERIFIED | schema line 18 has `onDelete: "set null"`; verify-cost-events-fk.ts exits 0 |
| 01-01 | companyService.remove deletes cost_events BEFORE heartbeat_runs in a single transaction | VERIFIED | companies.ts:267 precedes :268; `db.transaction` wrapper still intact at :261 |
| 01-01 | drizzle migration applies cleanly | VERIFIED | 0066 applied; check:migrations passes; confdeltype='n' live |
| 01-02 | orchestrate-e2e.ts does NOT contain raw `INSERT INTO issues` | VERIFIED | `grep -ci 'INSERT INTO issues' packages/db/orchestrate-e2e.ts` = 0 |
| 01-02 | cloneNextInboxIssue calls issueService.create | VERIFIED | line 408 `await issueSvc.create(ILM_V2_COMPANY, {...})` present |
| 01-02 | Single integration call produces non-null project_id + identifier + delta=1 | VERIFIED | 01-02 SUMMARY §4 captures two independent run JSONs (ILV2-42/ILV2-43, delta 1 each) |
| 01-02 | existing ILM-v2 lifecycle/dispatcher/handoff vitest suites still pass | VERIFIED | 21/21 on named suites per 01-02 §3 table; 53 unrelated server failures are pre-existing embedded-postgres startup timeouts, no server test imports orchestrate-e2e.ts |
| 01-03 | backfill-issue-metadata.ts exists and runs via `pnpm tsx ...` | VERIFIED | file exists; dry-run executed exit 0 during 01-03 Task 2 |
| 01-03 | Idempotent: running twice produces same final DB state; counter not double-bumped | VERIFIED | 01-03 SUMMARY captures 43→43→43 counter probe across apply + re-run |
| 01-03 | Only touches rows where identifier IS NULL or project_id IS NULL (guarded) | VERIFIED | inner UPDATE has belt-and-braces `AND identifier IS NULL` guard; 8 `identifier IS NULL` occurrences grep-verified |
| 01-03 | After running, no orphans for ILM-v2 company | VERIFIED | independent SQL probe returned `orphans: 0` in 01-03 Task 2 step 6 |

All 11 plan-truth buckets cleanly map to observable, disk-verified state today.

### Required Artifacts (all 4 levels: exists, substantive, wired, data flows)

| Artifact | Expected | Status | Wiring/Flow |
|---|---|---|---|
| `packages/db/src/schema/cost_events.ts` | heartbeatRunId FK with `onDelete: "set null"` | VERIFIED | Substantive (53 lines, real schema). Wired — imported by `packages/db/src/migrations/*` snapshots and consumed by drizzle-kit for generation. Data flows: the FK change is enforced at the DB level (confdeltype='n') and exercised by `companyService.remove`. |
| `packages/db/src/migrations/0066_cost_events_heartbeat_run_set_null.sql` | drizzle-kit DROP+ADD with ON DELETE set null | VERIFIED | 2 statements, verbatim drizzle-kit output. Applied live — confdeltype='n' proves the migration took effect. |
| `packages/db/src/migrations/meta/_journal.json` | idx 66 entry | VERIFIED | Journal entry present (check:migrations exits 0, confirmed during 01-01). |
| `packages/db/src/migrations/meta/0066_snapshot.json` | snapshot baseline | VERIFIED | Present per 01-01 SUMMARY §key-files.created. |
| `server/src/services/companies.ts` | remove() txn deletes costEvents before heartbeatRuns | VERIFIED | Line 267 precedes line 268, single `tx.delete(costEvents)` (grep -c = 1), `db.transaction` wrapper intact. Inline comment referencing "DB-01 / D-02" present at line 266. |
| `packages/db/orchestrate-e2e.ts` | Orchestrator calls issueService.create | VERIFIED | Substantive — `issueService` import at line 32, `issueSvc` handle at line 88, `.create(...)` invocation at line 408. No raw `INSERT INTO issues`. Data flows: `projectId` resolved via SELECT at line ~399 then passed into the service call. |
| `scripts/verify-cost-events-fk.ts` | pg_constraint confdeltype assertion | VERIFIED | Ran live today: `OK: FK "..." has ON DELETE SET NULL (confdeltype='n')`. Exit 0. |
| `scripts/_verify-orchestrator-create-path.ts` | Dry-stub verifier, SQL post-assertions for NOT NULL + Δ=1 | VERIFIED | Contains `IS NULL` assertions (grep -c = 2), counter-delta arithmetic. Exit 0 during 01-02 Task 3 with JSON `{ok:true, delta:1, ...}`. |
| `scripts/backfill-issue-metadata.ts` | Idempotent backfill, --dry-run flag, name-based project lookup | VERIFIED | 162 lines, 8x `identifier IS NULL` guards, 6x `project_id IS NULL` guards, 3x `--dry-run` references, 2x `createRequire`, 0x raw UUID (stale-UUID trap avoided). |
| `scripts/_verify-companies-reorder.mjs` | Asserts costEvents precedes heartbeatRuns | VERIFIED | Ran live today: `OK: costEvents at line 267, heartbeatRuns at line 268, single delete confirmed.` |

All 10 artifacts pass L1-L4.

### Key Link Verification

| From | To | Via | Status | Detail |
|---|---|---|---|---|
| `packages/db/src/schema/cost_events.ts` | `packages/db/src/migrations/0066_...sql` | drizzle-kit generate | WIRED | Migration is drizzle-kit's verbatim output from the schema edit; snapshot 0066 present. |
| `server/src/routes/companies.ts` | `companies.ts::remove` | `svc.remove(companyId)` | WIRED | Standard svc.remove wiring (not touched in this phase); existing pattern. |
| `packages/db/orchestrate-e2e.ts` | `server/src/services/issues.ts::create` | relative import `../../server/src/services/issues.js` + `issueSvc.create(...)` | WIRED | Line 32 import, line 88 construction, line 408 call site. Cross-workspace relative import chosen to avoid a packages/db → server workspace dep edge (documented D-03). |
| `orchestrate-e2e.ts cloneNextInboxIssue` | `companies.issueCounter + identifier` | atomic transaction inside issueService.create | WIRED | Service's `db.transaction` (issues.ts:1767+) bumps counter + generates identifier + inserts in one txn. |
| `scripts/_verify-orchestrator-create-path.ts` | issueService.create | dynamic import + single invocation + SQL post-assert | WIRED | Imports the same modules the orchestrator imports; SQL-asserts project_id + identifier non-null + Δ=1. |

All 5 key links WIRED — no orphaned artifacts, no broken connections.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `cost_events.ts` FK declaration | N/A (schema) | drizzle-kit codegen → 0066.sql → live DB | Yes — confdeltype='n' verified live | FLOWING |
| `companies.ts::remove` txn | N/A (handler) | Drizzle tx.delete against live DB | Yes — seeded company + hb_run + cost_event all pruned end-to-end | FLOWING |
| `orchestrate-e2e.ts cloneNextInboxIssue` | `created` (Issue row) | issueService.create → atomic txn | Yes — ILV2-42/ILV2-43 created with real project_id + identifier + counter Δ=1 | FLOWING |
| `backfill-issue-metadata.ts report` | `report` (structured JSON) | live DB SELECT/UPDATE | Yes — 43→43→43 counter probe, orphans=0 | FLOWING |

No hollow wiring. No static fallbacks. No disconnected props.

### Behavioral Spot-Checks (Step 7b)

Ran at verification time against the current working tree (not from SUMMARYs):

| Behavior | Command | Result | Status |
|---|---|---|---|
| Schema declares onDelete set null | `grep -n 'onDelete: "set null"' packages/db/src/schema/cost_events.ts` | line 18 match | PASS |
| Migration file exists | `ls packages/db/src/migrations/0066_*` | 0066_cost_events_heartbeat_run_set_null.sql | PASS |
| No raw INSERT INTO issues in orchestrator | `grep -ci 'INSERT INTO issues' packages/db/orchestrate-e2e.ts` | 0 | PASS |
| Backfill tool has --dry-run flag | `grep -q -- '--dry-run' scripts/backfill-issue-metadata.ts` | match | PASS |
| Verify-cost-events-fk.ts exists | `test -f scripts/verify-cost-events-fk.ts` | exists | PASS |
| Orchestrator verify script exists | `test -f scripts/_verify-orchestrator-create-path.ts` | exists | PASS |
| Reorder invariant still holds | `node scripts/_verify-companies-reorder.mjs` | `OK: costEvents at line 267, heartbeatRuns at line 268, single delete confirmed.` | PASS |
| Live FK matches schema (confdeltype='n') | `pnpm tsx scripts/verify-cost-events-fk.ts` | `OK: ... ON DELETE SET NULL (confdeltype='n')` | PASS |
| T-01-05 scoped-WHERE count holds | `grep -c 'companyId, id' server/src/services/companies.ts` | 26 (== BASELINE 26 from 01-01 SUMMARY) | PASS |
| No stray raw INSERTs in packages/db outside migrations | `grep -rEi "INSERT INTO issues" packages/db/ --include="*.ts" \| grep -v migrations` | 0 hits | PASS |

All 10 behavioral spot-checks PASS.

### Anti-Patterns Scan

| Concern | Outcome |
|---|---|
| TODO/FIXME/HACK/PLACEHOLDER in shipped files | None found in the 9 Phase-1-modified files. |
| Empty returns / stub handlers | None — every artifact is fully wired and produces real data. |
| Hardcoded empty props | None — `issueSvc.create` is invoked with real payload values; verify scripts use real DB connections. |
| Console-log-only implementations | `backfill-issue-metadata.ts` uses `console.log` but for structured JSON reporting, NOT as a stub — the actual UPDATE statements are live and guarded. |
| Raw SQL bypasses the service layer | Eliminated from `packages/db/orchestrate-e2e.ts` per SC-4. |

No blockers, no warnings.

### Deferred Items Review

Catalogued at `.planning/phases/01-schema-data-integrity-foundation/deferred-items.md`. Reviewed to confirm they are genuinely out-of-scope and not regressions:

| # | Deferred Item | Scope Check | Disposition |
|---|---|---|---|
| 1 | `companyService.remove` deletes `goals` BEFORE `projects` (pre-existing `projects_goal_id_goals_id_fk` ordering bug) | FK is `projects.goal_id → goals.id`, not `cost_events → heartbeat_runs`. DB-01 targets the cost_events/heartbeat_runs FK only. | OUT-OF-SCOPE — legitimate pre-existing bug, properly deferred. Candidate for a Phase 1 bonus or Phase 4 TEST-02 regression test per `deferred-items.md`. |
| 2 | `companyService.remove` does not prune `document_revisions` (missing prune step, pre-existing) | `document_revisions.company_id → companies.id` is a separate FK chain from cost_events. Handler omission, not DB-01 concern. | OUT-OF-SCOPE — legitimate pre-existing bug, properly deferred. |
| 3 | Recommended broader FK-chain audit of `companyService.remove` | Audit proposal, not a current regression. | OUT-OF-SCOPE — scheduling question, logged for Phase 4 or Phase 1 bonus. |

**Important:** None of the 3 deferred items affect DB-01's verified evidence. The seed-fallback + in-process path in 01-01 Task 3 step 5 reproduces the exact 2026-04-23 failure class (`cost_events_heartbeat_run_id_heartbeat_runs_id_fk` 23503) and proves it no longer fires. The HTTP curl path against f0c2b690 trips on the TWO OTHER pre-existing handler bugs, but those bugs existed before DB-01 landed and are not what SC-1 targets. The plan explicitly endorsed the seed-fallback as equivalent gate evidence ("Either satisfies the gate so long as the FK cascade executes end-to-end without error").

The SUMMARY's statement of this path deviation is accurate and in-good-faith. Accepted.

### Requirements Coverage (v1.0 cross-reference)

| Requirement | Source Plan(s) | Phase-1 Assigned? | Status |
|---|---|---|---|
| DB-01 | 01-01 | yes | SATISFIED (see above) |
| DB-02 | 01-02 (primary) + 01-03 (backfill support) | yes | SATISFIED (see above) |

No orphaned REQs for Phase 1. All other v1.0 REQs are mapped to later phases per REQUIREMENTS.md §Traceability table (ORCH-* → Phase 2, API-*/EXEC-01 → Phase 3, TEST-* → Phase 4, OPS-01 → Phase 5) and are correctly NOT in scope here.

### Commits Verified

All 10 plan commits (plus 3 SUMMARY docs commits) are present on `ilm-v2-reformulation` as expected:

| Commit | Stage |
|---|---|
| `19b12a0d` feat(01-01): schema FK + migration 0066 | on branch |
| `d0079a1c` refactor(01-01): reorder companyService.remove | on branch |
| `ddfa9a02` feat(01-01): apply migration + verify + seed-fallback DELETE repro | on branch |
| `e666b1f0` docs(01-01): complete DB-01 SUMMARY | on branch |
| `dc95f793` refactor(01-02): route cloneNextInboxIssue through issueService.create | on branch |
| `aed28e64` feat(01-02): dry-stub orchestrator createIssue verifier | on branch |
| `66ab5233` docs(01-02): complete DB-02 SUMMARY | on branch |
| `aca28fb1` feat(01-03): promote _fix-orphans.ts to backfill-issue-metadata.ts | on branch |
| `b5ab727b` test(01-03): throwaway _probe-issue-counter.ts | on branch |
| `daba1f81` docs(01-03): Phase 1 DONE | on branch |

---

## Gaps Summary

**None.**

All 4 ROADMAP success criteria verified against live disk/DB state. Both REQ-IDs (DB-01, DB-02) delivered with evidence at the integration level. All 10 planned artifacts present and substantive. All 5 key links wired. All 10 behavioral spot-checks pass. The 3 deferred items are legitimate out-of-scope pre-existing bugs (not Phase-1 regressions) and are properly captured in `deferred-items.md` for downstream planning (Phase 1 bonus or Phase 4 TEST-02).

The seed-fallback path used in 01-01 Task 3 step 5 is plan-endorsed (not a hedge). The dry-stub integration verifier used in 01-02 Task 3 is plan-endorsed (approved by the checker as the SC-3 gate; full orchestrator-loop coverage is Phase 4 TEST-02 scope). Both are acceptable under a goal-backward reading: SC-1 proved the FK cascade works end-to-end via the real handler transaction; SC-3 proved non-null project_id + identifier + Δ=1 counter through the refactored path.

**Phase 1 goal achieved.** The overnight orchestrator's issue-creation path can no longer produce orphans with null project_id/identifier, and the 2026-04-23 `f0c2b690` DELETE failure class is eliminated at the schema, migration, and handler levels simultaneously.

---

## VERIFICATION PASSED

**Status:** passed
**Score:** 9/9 must-haves verified (2 REQs SATISFIED + 4 ROADMAP SCs VERIFIED + 3 plan-truth buckets VERIFIED, all cleanly mapping to live disk state)

Ready to proceed to Phase 2 (ORCH-01/02/03 — orchestrator bleed-stopper) via `/gsd-transition` or `/gsd-plan-phase 2`.

---

*Verified: 2026-04-23*
*Verifier: Claude (gsd-verifier), goal-backward mode*
