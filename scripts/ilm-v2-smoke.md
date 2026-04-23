# ILM-v2 smoke test

End-to-end smoke for the ILM-v2 lifecycle pipeline. Drives one synthetic
issue through `inbox → spec_d → planned → implementing` and reports
what the dispatcher did when it saw the implementing transition.

This is Phase 9 (Tasks 9.1 + 9.2 combined) of the plan in
`docs/superpowers/plans/2026-04-22-paperclip-ilm-v2.md`.

## What the smoke does

1. Inserts a synthetic `issues` row in `lifecycle_state='inbox'` via
   direct SQL (bypassing the normal creation flow).
2. Posts three `POST /api/issues/:id/transition` calls:
   - `inbox → spec_d` as the CEO with `side_effects.spec_md`
   - `spec_d → planned` as the CTO with `side_effects.plan_md`
   - `UPDATE issues SET assignee_agent_id=BackendDev` (direct SQL — the
     transition route doesn't currently support reassignment)
   - `planned → implementing` as BackendDev — this triggers
     `dispatcherHook`, which calls `heartbeat.wakeup(backendDev,
     {payload:{issueId}})`.
3. Prints the dispatcher result (`{woken, blocked?, reason?}`) so you
   can tell whether the agent was actually dispatched.

## Preparing to run

### 1. Apply the seed SQL

The smoke needs a company with 3 agents (CEO, CTO, BackendDev). Apply
the seed once per fresh DB:

```bash
# Terminal 1: start the server so embedded-postgres is up on 54329
PAPERCLIP_FEATURE_ILM_V2=true pnpm dev:server
```

```bash
# Terminal 2: apply seed via the tsx helper (works without psql installed)
pnpm --filter @paperclipai/db exec tsx ../../scripts/ilm-v2-seed.ts
```

The helper cleans any stale ILM-v2 rows, runs the seed, and prints the UUIDs
in ready-to-export form:

```
ILM_V2_COMPANY_ID=<uuid>
ILM_V2_CEO_ID=<uuid>
ILM_V2_CTO_ID=<uuid>
ILM_V2_BACKEND_ID=<uuid>
```

(If you have `psql` installed, `psql <url> -f scripts/seed-ilm-v2.sql` also
works and emits the same UUIDs via `RAISE NOTICE`.)

### 2. Capture the UUIDs

Either copy them from the NOTICE output above, or re-query after the
fact:

```sql
SELECT name, role, id FROM agents
  WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM-v2')
  ORDER BY name;
```

### 3. Export env

```bash
export ILM_V2_COMPANY_ID=<company-uuid>
export ILM_V2_CEO_ID=<ceo-uuid>
export ILM_V2_CTO_ID=<cto-uuid>
export ILM_V2_BACKEND_ID=<backend-uuid>
```

## Running the smoke

```bash
pnpm --filter @paperclipai/db exec tsx ../../scripts/ilm-v2-smoke.ts
```

The `--filter @paperclipai/db` prefix is required because the `postgres`
package (postgres.js) is only hoisted under `packages/db/node_modules/`, so
tsx must resolve the import from that workspace.

Expected output: three `HTTP 200` transition responses, and the last one
contains a `dispatch` object. The dispatcher result depends on the env:

| `dispatch`                                    | Meaning                                                                                  |
|-----------------------------------------------|------------------------------------------------------------------------------------------|
| `{ woken: true }`                             | Dispatcher successfully invoked `heartbeat.wakeup`; look for a new `heartbeat_runs` row. |
| `{ woken: false, reason: "no assignee" }`     | Step 4 (UPDATE assignee) didn't land. Check the SQL.                                     |
| `{ woken: false, reason: "active run exists"}`| The agent already has a `status='running'` run. Expected on a warm DB.                   |
| `{ woken: false, reason: "repo mutex held" }` | Another issue in the same project is already implementing.                               |
| `{ woken: false, blocked: true, reason: ...}` | Budget guard tripped. Reset via `POST /api/budget/reset` or wait.                        |

## Limitations

This smoke does NOT exercise a real Codex run. Reasons:

- On Windows, Claude Code runs in an elevated shell, so embedded-postgres
  cannot boot directly from that shell — the server needs a non-elevated
  process (or a `schtasks /RL LIMITED` wrapper). We do not start the
  server from the smoke.
- Even with a running server, a real Codex run needs adapter credentials
  (`~/.codex` state) that are not provisioned by this smoke.
- `implementing → review → pr_open → merged` requires valid `handoff_md`
  fields, a real `branch`, and a real `pr_url`, all of which are agent
  outputs. Scripting synthetic versions of those would defeat the point
  of the smoke.

What the smoke DOES verify:

1. Flag-gated routes are wired up (`/api/issues/:id/transition`).
2. Lifecycle transitions write `issue_transitions` audit rows.
3. Side-effects (spec_md, plan_md) persist to `issues`.
4. `dispatcherHook` fires on `implementing` and, given an assignee,
   either wakes the agent or returns a well-known reason.

## Cleanup

```sql
DELETE FROM issue_transitions WHERE issue_id = '<issueId from smoke>';
DELETE FROM issues WHERE id = '<issueId from smoke>';
```

Or, to blow away the entire ILM-v2 seed:

```sql
DELETE FROM companies WHERE name = 'ILM-v2';
-- cascades through agents, issues, heartbeat_runs
```
