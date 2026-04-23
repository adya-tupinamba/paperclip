# Paperclip ILM-v2 — Core Rewrite Design

**Date:** 2026-04-22
**Status:** Approved (brainstorm complete, plan pending)
**Owner:** Adya Tupinamba
**Scope:** Approach 2 (Core Rewrite) — keep UI/DB/adapters, rewrite dispatcher + runtime + budget + monitoring.

## 1. Problem Statement

Paperclip ILM-v1 works but has 3 chronic failure modes:

1. **Scheduler heartbeat bleeds budget** — 30s poll per agent, $7/hour even when idle, no smart dispatch.
2. **Wake without `payload.issueId`** — `resolveWorkspaceForRun` falls back to cwd, breaks with `not a git repo`. Manual wake required hourly.
3. **No task lifecycle** — issues have generic status. Agents don't know whether to spec, plan, implement, review, or merge. PRs go orphan (see PR #5–8 on ILM-26 today).

Additional debt:

- Cost tracking broken for Codex (gpt-5.4 stream format unparsed) → dashboard says $0 while OpenAI bills normally.
- No budget hard-stop → runaway agent can burn $50 before human notices.
- Cursor CLI slot (BackendBurst/FrontendBurst) paused indefinitely — `cursor-agent` binary does not exist in any official form.

## 2. Goals

- **Zero-poll orchestration:** event-driven wake via API hook, fallback pull-queue when agent idle and has assigned work.
- **Explicit task state:** every issue has a `lifecycle_state` enforced at DB level; state transitions are the only way to advance.
- **Hard budget ceiling:** per-agent daily/hourly cap + per-issue cap + global daily cap. 402 at `/wake` when exceeded.
- **Real cost observability:** cost tracking works for Codex gpt-5.4; dashboard surfaces per-agent, per-issue, per-day spend.
- **Three well-defined dev roles:** CEO (CC#1), CTO+Frontend (CC#2), Backend+DevOps (Codex). 4th slot reserved until Cursor or another CLI matures.

## 3. Non-Goals

- Replace Paperclip UI / DB / adapters — all three work. Keep them.
- Native GitHub webhook integration — source of truth stays internal DB.
- Multi-company support — only ILM exists.
- Slack/Discord notifications — Obsidian vault + UI is enough.
- Fork Paperclip — stay on upstream so future `pnpm update` remains useful.

## 4. Architecture

### Stays intact

- `@paperclipai/core` DB schema (issues, agents, heartbeat_runs, runs, companies) — additive migrations only.
- UI React + `/ILM/*` routes.
- Adapters: `claude-local`, `codex-local`, `pi-local` (Gemini/ZAI available as pool if ever needed).
- Embedded Postgres port 54329.
- Two Windows workaround patches (arg-limit in `pi-local/execute.ts`, symlink→copyFile in `codex-local/codex-home.ts`).

### Removed / replaced

- Heartbeat 30s per-agent loop → deleted.
- Generic `scheduler/heartbeat.ts` → replaced by dispatcher.
- `resolveWorkspaceForRun` cwd fallback → explicit error when `issueId` missing.

### New modules (3)

1. **`packages/core/src/dispatcher/`** — who wakes whom and when.
   - `hook.ts` — called inline by issue/PR mutation endpoints.
   - `queue.ts` — `POST /api/agents/:id/pull-next` handler for agent-finished-work case.
   - `policy.ts` — "event beats queue; 1 active run per agent; budget gates everything".

2. **`packages/core/src/lifecycle/`** — task state machine.
   - State enum, valid transitions, side effects.
   - Stored procedure for atomic transition + audit write.

3. **`packages/core/src/budget/`** — hard-stop per agent/day.
   - Reads `heartbeat_runs.usage_json.cost.total` (with Codex fix).
   - Returns 402 at `/wake` when caps exceeded.

### Event-driven flow

```
Human/CTO → UI → PUT /api/issues/:id/transition {to, actor, reason}
                        ↓
                lifecycle.apply(issueId, to)  — validates transition + writes side effects
                        ↓
                dispatcher.hook(issueId)  — resolves target agent from state
                        ↓
                policy.gate(agentId, issueId)  — budget + concurrency + active-run check
                        ↓
                POST /api/agents/:id/wakeup {payload:{issueId}}
                        ↓
                worktree created + adapter run starts
```

### Pull-queue flow

```
Agent emits run done → lifecycle.apply advances (review / pr_open / merged / failed)
                            ↓
                    if agent now idle and has more assigned:
                      queue.findNextFor(agentId)
                        SELECT id FROM issues
                        WHERE assignee_id=$1 AND lifecycle_state IN ('planned','implementing')
                        ORDER BY priority DESC, created_at ASC
                        LIMIT 1
                            ↓
                    dispatcher.hook(nextId) → wake
                    else: agent stays idle (zero cost)
```

## 5. Task Lifecycle State Machine

```
inbox → spec'd → planned → implementing → review → pr_open → merged
  │        │         │          │            │         │
  ↓        ↓         ↓          ↓            ↓         ↓
blocked  rejected  rejected   failed      changes   conflict
                                          requested
```

### Valid transitions

| From → To | Actor | Side effect |
|---|---|---|
| `inbox → spec'd` | CEO or CTO | write `issue.spec_md` |
| `spec'd → planned` | CEO or assigned agent | write `issue.plan_md`, set `assignee` |
| `planned → implementing` | dispatcher (wake) | create worktree, initial commit |
| `implementing → review` | agent on done | push branch, set `issue.branch`, write `issue.handoff_md` |
| `review → pr_open` | CTO (approves review) | `gh pr create`, set `issue.pr_url` |
| `pr_open → merged` | human or CEO | `gh pr merge`, destroy worktree |
| `* → blocked` | any agent | set `blocker_reason`, notify CEO |
| `review → changes_requested` | CTO | back to `implementing` with comment |
| `implementing → failed` | runtime (3 retries exhausted) | pause agent on that issue |
| `* → rejected` | CEO | close issue, kill worktree |

### Migrations

```sql
ALTER TABLE issues ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'inbox';
ALTER TABLE issues ADD COLUMN spec_md TEXT;
ALTER TABLE issues ADD COLUMN plan_md TEXT;
ALTER TABLE issues ADD COLUMN handoff_md TEXT;
ALTER TABLE issues ADD COLUMN branch TEXT;
ALTER TABLE issues ADD COLUMN pr_url TEXT;
ALTER TABLE issues ADD COLUMN blocker_reason TEXT;
ALTER TABLE issues ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
CREATE INDEX issues_lifecycle_idx ON issues(lifecycle_state, assignee_id);

CREATE TABLE issue_transitions (
  id UUID PRIMARY KEY,
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id UUID NOT NULL,
  run_id UUID NULL REFERENCES runs(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX issue_transitions_issue_idx ON issue_transitions(issue_id, created_at DESC);
```

### Invariants

1. One active run per issue (unique constraint on `runs(issue_id)` where `status='running'`).
2. `merged` is terminal (trigger rejects update).
3. `blocked` requires `blocker_reason` (CHECK).
4. `retry_count ≤ 3` (CHECK).
5. Every transition that exits `implementing` requires non-empty `handoff_md`.

### Sole API

```
POST /api/issues/:id/transition  {to, reason, actor_id}
```

All state mutations go through this. No direct UPDATE of `lifecycle_state` elsewhere.

## 6. Agents

### CEO — Claude Code #1 (Opus, Max 20x)

- **CLI dir:** `C:\Users\ilm\.claude-paperclip\`
- **Operates states:** `inbox → spec'd`, `pr_open → merged`, `* → rejected`, budget alerts, cross-project arbitration.
- **Skills injected:** `paperclip`, `gsd-spec-phase`, `gsd-discuss-phase`.
- **Never:** writes feature code, comments on backend PR directly, signs merge without CTO review.

### CTO — Claude Code #2 (Opus, Max 20x)

- **CLI dir:** `C:\Users\ilm\.claude-paperclip-cto\` (new, isolated from CEO)
- **Operates states:** `spec'd → planned`, `review → pr_open`, `review → changes_requested`, security scans.
- **Also runs Frontend work:** when `issue.type='frontend'` and state is `planned → implementing`, CTO implements (Opus excels at React/TS). Blocks backend review while frontend `implementing`.
- **Review starvation fallback:** if any issue sits in `review` > 2h while CTO is `implementing`, CEO auto-takes the review role for that issue (transition `review → pr_open` or `review → changes_requested`). Logged in `issue_transitions` with `actor=CEO, reason='cto_busy_fallback'`.
- **Skills injected:** `gsd-plan-phase`, `gsd-code-review`, `gsd-secure-phase`, `engineering:code-review`.
- **Never:** approves own PR, commits without spec+plan, bypasses RLS.

### BackendDev — Codex (gpt-5.4)

- **Sandbox:** `dangerouslyBypassApprovalsAndSandbox: true`.
- **Operates states:** `planned → implementing` when `issue.type IN ['backend','devops','data','security-fix']`.
- **Skills injected:** `gsd-execute-phase`, `supabase:supabase`, `vercel:nextjs`.
- **Domain:** Python/FastAPI, SQL/migrations, scripts de coleta, Vercel infra, ingestão.
- **Never:** opens PR (only pushes branch + transitions to review), direct merge, alters RLS without `security_review=required` flag.

### Reserved slot — Cursor / TBD

Cursor CLI does not exist as autonomous agent binary (spiked 2026-04-22: `cursor.exe` is IDE launcher only, no agent subcommand; `@cursor/cli` 404 on npm). Keep the adapter code, keep the agent row paused in DB. Revisit when Cursor ships official CLI or pivot to `aider` / `opencode-local`.

### Handoff contract (canonical)

Every agent, on run done, writes to `issue.handoff_md`:

```markdown
## Handoff
- **From:** <Role>
- **To:** <next Role>
- **Next state:** <state>
- **Summary:** <3 bullets max>
- **Changed files:** <list>
- **Tests:** <command + result>
- **Risks:** <1-3 items>
- **Blockers:** <empty OR description>
```

State machine rejects transitions out of `implementing` / `review` with empty `handoff_md`.

### AGENTS.md rewrite

Each role gets fresh `C:\Users\ilm\.paperclip\drafts\ILM-v2\<Role>\AGENTS.md` covering:

- Mission (3 lines).
- Operated states (filtered list).
- Permissions (CAN / CANNOT).
- Mandatory handoff format.
- Skills catalog + when to use each.
- 3 few-shot execution examples.

## 7. Failure, Retry, Budget

### Retry

- Run fails (non-zero exit, 15min timeout, or empty `handoff_md`) → `retry_count += 1`.
- `retry_count < 3` → dispatcher schedules re-wake with `60s * 2^retry` backoff.
- `retry_count == 3` → `transition → failed`, pause agent on that issue (other issues keep flowing).
- CEO can reset: `POST /api/issues/:id/reset-retries`.

### Budget caps

```ts
const CAPS = {
  per_agent_daily: 5.00,    // USD, calendar day UTC-3 (America/Sao_Paulo)
  per_agent_hourly: 1.00,   // rolling 60min window (NOW() - 1h)
  per_issue_total: 2.00,    // lifetime of issue across all runs
  global_daily: 15.00       // sum of all agents, calendar day UTC-3
};
```

- `budget.guard(agentId, issueId)` runs before every `/wake`.
- Exceeded → `/wake` returns 402 + `transition → blocked` with `blocker_reason='budget_exceeded'`.
- CEO notified via internal `POST /api/notifications`.
- Manual reset (human only): `POST /api/budget/reset {scope}`.

### Cost tracking fix (Codex bug)

- Root cause: `codex-local/src/server/execute.ts` doesn't parse gpt-5.4 stream usage block (different format from gpt-4o).
- Fix: add parser in `codex-local/src/server/parse.ts` extracting `input_tokens`, `output_tokens`, `cached_tokens` from final stream block.
- New `packages/core/src/pricing.ts` with static `COSTS_PER_MODEL` table.
- Write into `heartbeat_runs.usage_json.cost.total` on run finalization.

### Concurrency rules

- 1 active run per agent (DB constraint).
- Max 3 `implementing` issues per project (worktree conflict prevention).
- Per-repo mutex: no two agents `implementing` in same `repo_id` simultaneously. Queue waits.

### Watchdog

- Internal cron 5min: find runs `status='running' AND NOW() - last_heartbeat_at > 20min` → kill process, `retry_count += 1`.

## 8. Monitoring & Observability

### New dashboard `/ILM/ops`

1. **Agents panel** — status (idle/running/paused/blocked), last action, current run.
2. **Pipeline kanban** — all issues grouped by `lifecycle_state`.
3. **Budget today** — per-agent spend vs cap, color bar.
4. **Transitions feed** — last 20 live via WebSocket.
5. **Alerts** — budget ≥ 80% cap, `retry_count = 2`, `blocked > 1h`.

Backend: `GET /api/ops/snapshot` + WebSocket `/api/ops/stream` emitting per-transition, per-run, per-budget-tick events.

### Daily export

- `GET /api/ops/daily-report` → JSON (merged issues, real cost, retries, avg time per state).
- CEO runs 8am cron, posts summary to `C:\Users\ilm\Documents\ObsidianVault\ILM\ops\YYYY-MM-DD.md`.

## 9. Testing Strategy

### Unit

- `dispatcher/policy.ts` — pure function, tests cover: event vs queue precedence, budget reject, concurrency reject, active-run reject.
- `lifecycle/transitions.ts` — truth table of valid/invalid transitions (34 cases).
- `budget/guard.ts` — cap math + aggregation edge cases.
- `pricing.ts` — all models covered, token→cost math.

### Integration

- Spin embedded-pg in test env, run full lifecycle: `inbox → merged` for a synthetic issue, assert every transition, handoff content, budget accrual.
- Codex cost parser: feed 3 real NDJSON captures, assert parsed cost matches OpenAI dashboard within 1¢.

### E2E

- Script `scripts/test-ilm-v2.ts`: seeds 3 issues (1 backend, 1 frontend, 1 security-fix), wakes dispatcher, waits for all 3 to reach `pr_open`, asserts budget ≤ $6 total.

### Manual smoke

- After deploy, tu cria 1 issue real no UI, assigna CTO, confirma: wake fires, agent runs, PR opens, dashboard updates.

## 10. Rollout

1. Branch `ilm-v2-reformulation` on paperclip repo.
2. Migrations shipped first (additive; ILM-v1 keeps running until flip).
3. Dispatcher + lifecycle + budget behind `FEATURE_ILM_V2=false` flag.
4. New `/ILM/ops` dashboard built on new endpoints.
5. Smoke test on 1 issue with flag enabled → if green, flip permanently.
6. Delete old heartbeat loop, archive ILM-v1 drafts.

### Preservation checklist (must survive any upstream pull)

- Windows arg-limit patch (`pi-local/execute.ts`).
- Codex symlink→copyFile patch (`codex-local/codex-home.ts`).
- Codex cost parser (new; `codex-local/parse.ts`).
- 3 new core modules (`dispatcher/`, `lifecycle/`, `budget/`).

## 11. Out of Scope (deferred)

- Cursor or aider integration (4th slot reserved).
- Native GitHub webhooks.
- Slack/Discord notifications.
- Multi-company features.
- Multi-tenancy beyond single-user.
