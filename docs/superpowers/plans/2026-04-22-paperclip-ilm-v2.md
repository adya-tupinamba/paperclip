# Paperclip ILM-v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Paperclip's per-agent heartbeat with an event-driven dispatcher + pull-queue, add explicit task lifecycle, hard budget caps, fix Codex cost tracking, and ship 3 well-defined dev agents (CEO on CC#1, CTO+Frontend on CC#2, Backend+DevOps on Codex) that run real work end-to-end with zero idle bleed.

**Architecture:** Keep Paperclip UI, DB, adapters, and the two Windows workaround patches. Delete the 30s heartbeat loop. Add three new service modules — `dispatcher/` (hook + pull-queue + policy gate), `lifecycle/` (task state machine with audit log), `budget/` (per-agent/issue/global caps). All state transitions funnel through one `POST /api/issues/:id/transition` endpoint. Event wake fires inline from the transition hook; queue wake fires when an agent finishes and has more assigned work. Ship behind `FEATURE_ILM_V2=false` flag, smoke-test, flip.

**Tech Stack:** TypeScript, Node.js, embedded Postgres (port 54329), Express, Vitest, React/Vite (UI), pnpm workspaces. Adapters: `claude-local` (Opus), `codex-local` (gpt-5.4), `pi-local` (reserve). Windows-specific patches already in place.

**Branch:** `ilm-v2-reformulation` (spec committed in commit a349acf).

**Spec reference:** `docs/superpowers/specs/2026-04-22-paperclip-ilm-v2-design.md`

**Repo root:** `C:\Users\ilm\Documents\GitHub\paperclip`

---

## File Structure

### New files

| Path | Purpose |
|---|---|
| `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql` | Additive schema: lifecycle cols + `issue_transitions` table |
| `packages/shared/src/lifecycle-states.ts` | State enum + valid-transitions map |
| `packages/shared/src/pricing.ts` | `COSTS_PER_MODEL` table (per 1M tokens) |
| `server/src/services/lifecycle.ts` | `applyTransition()` — atomic state change + audit |
| `server/src/services/lifecycle.test.ts` | Transition truth table + invariants |
| `server/src/services/handoff.ts` | Handoff markdown parse + validate |
| `server/src/services/handoff.test.ts` | Handoff validation tests |
| `server/src/services/dispatcher.ts` | Hook + pullNext + policy gate |
| `server/src/services/dispatcher.test.ts` | Dispatcher unit tests |
| `server/src/services/budget-guard.ts` | Cap checks with aggregation queries |
| `server/src/services/budget-guard.test.ts` | Budget math + edge cases |
| `server/src/routes/issues-transition.ts` | `POST /api/issues/:id/transition` |
| `server/src/routes/agents-pull-next.ts` | `POST /api/agents/:id/pull-next` |
| `server/src/routes/budget-reset.ts` | `POST /api/budget/reset` (human-only) |
| `server/src/routes/ops.ts` | Snapshot + daily-report + WebSocket stream |
| `server/src/__tests__/ilm-v2-e2e.test.ts` | End-to-end lifecycle test |

> **Schema notes from Phase 1 execution (2026-04-22):**
> - Issue assignee column is `assignee_agent_id` (not `assignee_id`). All SQL in later phases must use this name.
> - Run-tracking table is `heartbeat_runs` (not `runs`). All FKs + SELECTs must use this. For the "active run for agent" check, filter `heartbeat_runs` by `agent_id` and the appropriate liveness column. Check the schema at `packages/db/src/schema/heartbeat_runs.ts` for exact column names (`status`, `finishedAt`, etc.).
> - Claude Code's shell runs as Windows admin — embedded-postgres refuses to start under admin. Migrations and DB-touching smoke tests must be run via `schtasks /CREATE /TN paperclip-pg-<tag> /RU <user> /SC ONCE /RL LIMITED ...` or from a non-elevated shell. Phase 1 used schtasks workaround; later phases should mirror or document the constraint.

| `packages/adapters/codex-local/src/server/parse-usage.ts` | gpt-5.4 stream usage parser |
| `packages/adapters/codex-local/src/server/parse-usage.test.ts` | Parser tests with real NDJSON captures |
| `.paperclip/drafts/ILM-v2/CEO/AGENTS.md` | CEO role contract |
| `.paperclip/drafts/ILM-v2/CTO/AGENTS.md` | CTO+Frontend role contract |
| `.paperclip/drafts/ILM-v2/BackendDev/AGENTS.md` | Backend+DevOps role contract |
| `.paperclip/drafts/ILM-v2/README.md` | Draft overview + UUIDs |
| `scripts/ilm-v2-seed.ts` | Archive ILM-v1, seed ILM-v2 company with 3 agents |
| `scripts/ilm-v2-smoke.ts` | E2E smoke: 1 synthetic issue inbox → merged |

### Modified files

| Path | Change |
|---|---|
| `packages/shared/src/config-schema.ts` | Add `FEATURE_ILM_V2: boolean` feature flag |
| `packages/adapters/codex-local/src/server/execute.ts` | Call `parse-usage` on run finalize |
| `server/src/routes/issues.ts` | Remove direct `lifecycle_state` writes (if any); delegate to transition route |
| `server/src/routes/issues-checkout-wakeup.ts` | Require `payload.issueId`, error when missing (no cwd fallback) |
| `server/src/services/cron.ts` | Register watchdog (5min) + daily-report (08:00) |
| `server/src/services/heartbeat-run-summary.ts` | Hook post-run lifecycle advance call |
| `server/src/app.ts` | Mount new routes; gate behind `FEATURE_ILM_V2` |

### Deleted at end (after flag flip)

| Path | Why |
|---|---|
| (old per-agent heartbeat loop — exact file TBD in Phase 7) | Replaced by dispatcher |

---

## Phase 0 — Setup & Feature Flag

### Task 0.1: Confirm branch + spec present

**Files:**
- Read: `docs/superpowers/specs/2026-04-22-paperclip-ilm-v2-design.md`

- [ ] **Step 1: Check branch is `ilm-v2-reformulation`**

```bash
cd C:/Users/ilm/Documents/GitHub/paperclip && git branch --show-current
```

Expected output: `ilm-v2-reformulation`

- [ ] **Step 2: Confirm spec commit exists**

```bash
git log --oneline -5 docs/superpowers/specs/
```

Expected: first line is `a349acf docs(ilm-v2): add Paperclip ILM-v2 Core Rewrite design spec`

### Task 0.2: Add `FEATURE_ILM_V2` flag

**Files:**
- Modify: `packages/shared/src/config-schema.ts`

- [ ] **Step 1: Read existing config schema**

```bash
grep -n "FEATURE_" packages/shared/src/config-schema.ts || echo "no FEATURE_ vars yet"
```

- [ ] **Step 2: Add `FEATURE_ILM_V2` entry**

Add to the schema object (default `false`):

```ts
FEATURE_ILM_V2: z.coerce.boolean().default(false),
```

Place alphabetically near other `FEATURE_*` or at the feature flags section.

- [ ] **Step 3: Confirm typecheck passes**

```bash
pnpm --filter @paperclipai/shared tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/config-schema.ts
git commit -m "feat(ilm-v2): add FEATURE_ILM_V2 feature flag (default false)"
```

---

## Phase 1 — Database Migration

### Task 1.1: Write migration SQL

**Files:**
- Create: `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql`

- [ ] **Step 1: Confirm next migration number**

```bash
ls packages/db/src/migrations/ | grep -E "^[0-9]{4}_" | sort | tail -3
```

Expected: last is `0064_*`. We use `0065`.

- [ ] **Step 2: Write migration**

```sql
-- 0065_ilm_v2_lifecycle.sql
-- ILM-v2: task lifecycle state machine + handoff + audit.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'inbox',
  ADD COLUMN IF NOT EXISTS spec_md TEXT,
  ADD COLUMN IF NOT EXISTS plan_md TEXT,
  ADD COLUMN IF NOT EXISTS handoff_md TEXT,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS pr_url TEXT,
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

ALTER TABLE issues
  ADD CONSTRAINT chk_issue_retry_cap CHECK (retry_count <= 3),
  ADD CONSTRAINT chk_issue_blocked_has_reason
    CHECK (lifecycle_state != 'blocked' OR blocker_reason IS NOT NULL),
  ADD CONSTRAINT chk_issue_lifecycle_state CHECK (
    lifecycle_state IN (
      'inbox','spec_d','planned','implementing','review',
      'pr_open','merged','blocked','rejected','failed','changes_requested'
    )
  );

CREATE INDEX IF NOT EXISTS issues_lifecycle_idx
  ON issues(lifecycle_state, assignee_agent_id);

CREATE TABLE IF NOT EXISTS issue_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id UUID NOT NULL,
  run_id UUID NULL REFERENCES runs(id),
  reason TEXT,
  handoff_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_transitions_issue_idx
  ON issue_transitions(issue_id, created_at DESC);

-- Enforce `merged` terminality via trigger.
CREATE OR REPLACE FUNCTION trg_issues_merged_terminal()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_state = 'merged' AND NEW.lifecycle_state <> 'merged' THEN
    RAISE EXCEPTION 'cannot transition out of merged (issue %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS issues_merged_terminal ON issues;
CREATE TRIGGER issues_merged_terminal
  BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION trg_issues_merged_terminal();
```

- [ ] **Step 3: Run migration against local dev DB**

```bash
pnpm --filter @paperclipai/db migrate
```

Expected: `Applied migration 0065_ilm_v2_lifecycle.sql`. No errors.

- [ ] **Step 4: Verify columns exist**

```bash
pnpm --filter @paperclipai/db exec node -e "
  import('./src/client.js').then(async m => {
    const c = await m.clientForLocalEmbedded();
    const r = await c.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='issues' AND column_name IN ('lifecycle_state','spec_md','plan_md','handoff_md','branch','pr_url','blocker_reason','retry_count')\");
    console.log(r.rows);
    await c.end();
  });
"
```

Expected: 8 rows.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/0065_ilm_v2_lifecycle.sql
git commit -m "feat(ilm-v2): add lifecycle state machine schema (migration 0065)"
```

---

## Phase 2 — Lifecycle Module (TDD)

### Task 2.1: Write shared states file (test first)

**Files:**
- Create: `packages/shared/src/lifecycle-states.ts`
- Create: `packages/shared/src/lifecycle-states.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// lifecycle-states.test.ts
import { describe, it, expect } from 'vitest';
import { isValidTransition, LIFECYCLE_STATES } from './lifecycle-states.js';

describe('lifecycle states', () => {
  it('exposes 11 states', () => {
    expect(LIFECYCLE_STATES.length).toBe(11);
  });

  it('permits inbox → spec_d', () => {
    expect(isValidTransition('inbox', 'spec_d')).toBe(true);
  });

  it('rejects inbox → merged (skip states)', () => {
    expect(isValidTransition('inbox', 'merged')).toBe(false);
  });

  it('permits any state → blocked', () => {
    expect(isValidTransition('implementing', 'blocked')).toBe(true);
    expect(isValidTransition('review', 'blocked')).toBe(true);
  });

  it('rejects merged → anything (terminal)', () => {
    expect(isValidTransition('merged', 'inbox')).toBe(false);
    expect(isValidTransition('merged', 'pr_open')).toBe(false);
  });

  it('permits review → changes_requested → implementing', () => {
    expect(isValidTransition('review', 'changes_requested')).toBe(true);
    expect(isValidTransition('changes_requested', 'implementing')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module doesn't exist)**

```bash
pnpm --filter @paperclipai/shared vitest run src/lifecycle-states.test.ts
```

Expected: `Cannot find module './lifecycle-states.js'`.

- [ ] **Step 3: Write the module**

```ts
// lifecycle-states.ts
export const LIFECYCLE_STATES = [
  'inbox','spec_d','planned','implementing','review',
  'pr_open','merged','blocked','rejected','failed','changes_requested',
] as const;

export type LifecycleState = typeof LIFECYCLE_STATES[number];

const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  inbox:              ['spec_d','rejected','blocked'],
  spec_d:             ['planned','rejected','blocked'],
  planned:            ['implementing','rejected','blocked'],
  implementing:       ['review','failed','blocked'],
  review:             ['pr_open','changes_requested','blocked','rejected'],
  pr_open:            ['merged','changes_requested','blocked','rejected'],
  merged:             [],
  blocked:            ['inbox','spec_d','planned','implementing','review','pr_open','rejected'],
  rejected:           [],
  failed:             ['implementing','rejected','blocked'],
  changes_requested:  ['implementing','blocked','rejected'],
};

export function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNext(from: LifecycleState): readonly LifecycleState[] {
  return TRANSITIONS[from];
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @paperclipai/shared vitest run src/lifecycle-states.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/lifecycle-states.ts packages/shared/src/lifecycle-states.test.ts
git commit -m "feat(ilm-v2): add lifecycle state map with transition rules"
```

### Task 2.2: Handoff validator

**Files:**
- Create: `server/src/services/handoff.ts`
- Create: `server/src/services/handoff.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// handoff.test.ts
import { describe, it, expect } from 'vitest';
import { validateHandoff } from './handoff.js';

const CANONICAL = `## Handoff
- **From:** BackendDev
- **To:** CTO
- **Next state:** review
- **Summary:** did thing
- **Changed files:** a.py
- **Tests:** pytest a.py — 3 passed
- **Risks:** none
- **Blockers:**`;

describe('validateHandoff', () => {
  it('accepts canonical format', () => {
    const r = validateHandoff(CANONICAL);
    expect(r.ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(validateHandoff('').ok).toBe(false);
    expect(validateHandoff('   \n').ok).toBe(false);
  });
  it('rejects missing From', () => {
    const bad = CANONICAL.replace('- **From:** BackendDev', '');
    expect(validateHandoff(bad).ok).toBe(false);
  });
  it('rejects missing Next state', () => {
    const bad = CANONICAL.replace('- **Next state:** review', '');
    expect(validateHandoff(bad).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @paperclipai/server vitest run src/services/handoff.test.ts
```

- [ ] **Step 3: Implement**

```ts
// handoff.ts
export type HandoffResult = { ok: true } | { ok: false; reason: string };

const REQUIRED_FIELDS = ['From:', 'To:', 'Next state:', 'Summary:', 'Changed files:', 'Tests:'];

export function validateHandoff(md: string | null | undefined): HandoffResult {
  if (!md || !md.trim()) return { ok: false, reason: 'empty' };
  for (const field of REQUIRED_FIELDS) {
    if (!md.includes(field)) return { ok: false, reason: `missing ${field}` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/handoff.ts server/src/services/handoff.test.ts
git commit -m "feat(ilm-v2): add handoff markdown validator"
```

### Task 2.3: `applyTransition` service

**Files:**
- Create: `server/src/services/lifecycle.ts`
- Create: `server/src/services/lifecycle.test.ts`

- [ ] **Step 1: Write failing test using embedded-pg**

```ts
// lifecycle.test.ts — exercises real DB via embedded-pg
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../__tests__/test-db.js'; // existing helper
import { applyTransition } from './lifecycle.js';

let ctx: any;
beforeAll(async () => { ctx = await setupTestDb(); });
afterAll(async () => { await teardownTestDb(ctx); });

describe('applyTransition', () => {
  it('advances inbox → spec_d and records transition row', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'inbox' });
    const ceoId = ctx.actors.ceo;
    const r = await applyTransition(ctx.db, {
      issueId, to: 'spec_d', actorId: ceoId, reason: 'spec written',
      sideEffects: { spec_md: '# Spec\n...' },
    });
    expect(r.ok).toBe(true);
    const issue = await ctx.db.query('SELECT lifecycle_state, spec_md FROM issues WHERE id=$1', [issueId]);
    expect(issue.rows[0].lifecycle_state).toBe('spec_d');
    expect(issue.rows[0].spec_md).toContain('# Spec');
    const audit = await ctx.db.query('SELECT from_state, to_state FROM issue_transitions WHERE issue_id=$1', [issueId]);
    expect(audit.rows[0]).toEqual({ from_state: 'inbox', to_state: 'spec_d' });
  });

  it('rejects invalid transition', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'inbox' });
    const r = await applyTransition(ctx.db, {
      issueId, to: 'merged', actorId: ctx.actors.ceo, reason: 'skip',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid transition/i);
  });

  it('rejects exit-of-implementing without handoff_md', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'implementing' });
    const r = await applyTransition(ctx.db, {
      issueId, to: 'review', actorId: ctx.actors.backend, reason: 'done',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/handoff_md required/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `lifecycle.ts`**

```ts
// server/src/services/lifecycle.ts
import type { Pool, PoolClient } from 'pg';
import { isValidTransition, type LifecycleState } from '@paperclipai/shared/lifecycle-states';
import { validateHandoff } from './handoff.js';

export type TransitionInput = {
  issueId: string;
  to: LifecycleState;
  actorId: string;
  runId?: string;
  reason?: string;
  sideEffects?: {
    spec_md?: string; plan_md?: string; handoff_md?: string;
    branch?: string; pr_url?: string; blocker_reason?: string;
  };
};

export type TransitionResult =
  | { ok: true; fromState: LifecycleState; toState: LifecycleState }
  | { ok: false; reason: string };

const EXIT_REQUIRES_HANDOFF: readonly LifecycleState[] = ['implementing','review'];

export async function applyTransition(db: Pool, input: TransitionInput): Promise<TransitionResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT lifecycle_state, handoff_md FROM issues WHERE id=$1 FOR UPDATE',
      [input.issueId]
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'issue not found' };
    }
    const fromState = cur.rows[0].lifecycle_state as LifecycleState;
    if (!isValidTransition(fromState, input.to)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: `invalid transition ${fromState} → ${input.to}` };
    }

    const newHandoff = input.sideEffects?.handoff_md ?? cur.rows[0].handoff_md;
    if (EXIT_REQUIRES_HANDOFF.includes(fromState)) {
      const v = validateHandoff(newHandoff);
      if (!v.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: `handoff_md required leaving ${fromState}: ${v.reason}` };
      }
    }

    const sets: string[] = ['lifecycle_state=$1'];
    const vals: unknown[] = [input.to];
    let i = 2;
    const se = input.sideEffects ?? {};
    for (const key of ['spec_md','plan_md','handoff_md','branch','pr_url','blocker_reason'] as const) {
      if (se[key] !== undefined) { sets.push(`${key}=$${i}`); vals.push(se[key]); i++; }
    }
    vals.push(input.issueId);
    await client.query(`UPDATE issues SET ${sets.join(', ')} WHERE id=$${i}`, vals);

    await client.query(
      `INSERT INTO issue_transitions
         (issue_id, from_state, to_state, actor_id, run_id, reason, handoff_md)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.issueId, fromState, input.to, input.actorId,
       input.runId ?? null, input.reason ?? null, newHandoff ?? null]
    );

    await client.query('COMMIT');
    return { ok: true, fromState, toState: input.to };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/lifecycle.ts server/src/services/lifecycle.test.ts
git commit -m "feat(ilm-v2): applyTransition service with atomic DB + audit"
```

---

## Phase 3 — Budget Module (TDD)

### Task 3.1: Pricing table

**Files:**
- Create: `packages/shared/src/pricing.ts`

- [ ] **Step 1: Write module**

```ts
// pricing.ts — prices in USD per 1M tokens, current as of 2026-04
export type ModelId =
  | 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'
  | 'gpt-5.4' | 'gpt-5-mini' | 'gemini-3.1-pro' | 'glm-5.1';

export const COSTS_PER_MODEL: Record<ModelId, { in: number; out: number; cachedIn?: number }> = {
  'claude-opus-4-7':   { in: 15.00, out: 75.00, cachedIn: 1.50 },
  'claude-sonnet-4-6': { in:  3.00, out: 15.00, cachedIn: 0.30 },
  'claude-haiku-4-5':  { in:  0.80, out:  4.00, cachedIn: 0.08 },
  'gpt-5.4':           { in:  1.25, out: 10.00, cachedIn: 0.125 },
  'gpt-5-mini':        { in:  0.25, out:  2.00, cachedIn: 0.025 },
  'gemini-3.1-pro':    { in:  1.25, out: 10.00, cachedIn: 0.30 },
  'glm-5.1':           { in:  0.60, out:  2.20 },
};

export function computeCost(
  modelId: ModelId,
  tokens: { input: number; output: number; cached?: number }
): number {
  const p = COSTS_PER_MODEL[modelId];
  const inputCost = ((tokens.input - (tokens.cached ?? 0)) * p.in) / 1_000_000;
  const cachedCost = ((tokens.cached ?? 0) * (p.cachedIn ?? p.in)) / 1_000_000;
  const outputCost = (tokens.output * p.out) / 1_000_000;
  return Math.max(0, inputCost + cachedCost + outputCost);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @paperclipai/shared tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/pricing.ts
git commit -m "feat(ilm-v2): add pricing table + computeCost helper"
```

### Task 3.2: Budget guard

**Files:**
- Create: `server/src/services/budget-guard.ts`
- Create: `server/src/services/budget-guard.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// budget-guard.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../__tests__/test-db.js';
import { checkBudget } from './budget-guard.js';

let ctx: any;
beforeAll(async () => { ctx = await setupTestDb(); });
afterAll(async () => { await teardownTestDb(ctx); });

describe('checkBudget', () => {
  it('allows when no spend', async () => {
    const r = await checkBudget(ctx.db, { agentId: ctx.actors.backend, issueId: null });
    expect(r.ok).toBe(true);
  });
  it('blocks per-agent daily cap', async () => {
    await ctx.seedRunCost(ctx.actors.backend, 5.01);
    const r = await checkBudget(ctx.db, { agentId: ctx.actors.backend, issueId: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/per_agent_daily/);
  });
  it('blocks per-issue cap', async () => {
    const issueId = await ctx.seedIssue({});
    await ctx.seedRunCost(ctx.actors.backend, 2.01, issueId);
    const r = await checkBudget(ctx.db, { agentId: ctx.actors.backend, issueId });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/per_issue_total/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// budget-guard.ts
import type { Pool } from 'pg';

export const CAPS = {
  per_agent_daily: 5.00,
  per_agent_hourly: 1.00,
  per_issue_total: 2.00,
  global_daily: 15.00,
} as const;

export type BudgetResult = { ok: true } | { ok: false; reason: string };

export async function checkBudget(
  db: Pool,
  args: { agentId: string; issueId: string | null }
): Promise<BudgetResult> {
  const { agentId, issueId } = args;

  const dailyAgent = await sumCost(db,
    "WHERE agent_id=$1 AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')",
    [agentId]);
  if (dailyAgent > CAPS.per_agent_daily)
    return { ok: false, reason: `per_agent_daily exceeded ($${dailyAgent.toFixed(2)} > $${CAPS.per_agent_daily})` };

  const hourlyAgent = await sumCost(db,
    "WHERE agent_id=$1 AND started_at >= now() - interval '1 hour'",
    [agentId]);
  if (hourlyAgent > CAPS.per_agent_hourly)
    return { ok: false, reason: `per_agent_hourly exceeded ($${hourlyAgent.toFixed(2)})` };

  if (issueId) {
    const issueTotal = await sumCost(db,
      "WHERE issue_id=$1", [issueId]);
    if (issueTotal > CAPS.per_issue_total)
      return { ok: false, reason: `per_issue_total exceeded ($${issueTotal.toFixed(2)})` };
  }

  const dailyGlobal = await sumCost(db,
    "WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')", []);
  if (dailyGlobal > CAPS.global_daily)
    return { ok: false, reason: `global_daily exceeded ($${dailyGlobal.toFixed(2)})` };

  return { ok: true };
}

async function sumCost(db: Pool, where: string, params: unknown[]): Promise<number> {
  const sql = `SELECT COALESCE(SUM((usage_json->'cost'->>'total')::numeric), 0) AS total
               FROM heartbeat_runs ${where}`;
  const r = await db.query(sql, params);
  return Number(r.rows[0].total ?? 0);
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/budget-guard.ts server/src/services/budget-guard.test.ts
git commit -m "feat(ilm-v2): budget guard with 4 cap tiers"
```

---

## Phase 4 — Dispatcher (TDD)

### Task 4.1: Policy gate + hook + pullNext

**Files:**
- Create: `server/src/services/dispatcher.ts`
- Create: `server/src/services/dispatcher.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// dispatcher.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb } from '../__tests__/test-db.js';
import { dispatcherHook, pullNextForAgent } from './dispatcher.js';

let ctx: any;
beforeAll(async () => { ctx = await setupTestDb(); });
afterAll(async () => { await teardownTestDb(ctx); });

describe('dispatcherHook', () => {
  it('wakes agent when issue enters implementing and budget ok', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'planned', assignee_agent_id: ctx.actors.backend });
    const wake = vi.fn(async () => ({ runId: 'r1' }));
    await dispatcherHook(ctx.db, { issueId, toState: 'implementing' }, { wake });
    expect(wake).toHaveBeenCalledWith({ agentId: ctx.actors.backend, issueId });
  });
  it('does not wake when budget exceeded', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'planned', assignee_agent_id: ctx.actors.backend });
    await ctx.seedRunCost(ctx.actors.backend, 5.50);
    const wake = vi.fn();
    const r = await dispatcherHook(ctx.db, { issueId, toState: 'implementing' }, { wake });
    expect(wake).not.toHaveBeenCalled();
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/per_agent_daily/);
  });
  it('does not wake when agent already has active run', async () => {
    const issueId = await ctx.seedIssue({ lifecycle_state: 'planned', assignee_agent_id: ctx.actors.backend });
    await ctx.seedActiveRun(ctx.actors.backend);
    const wake = vi.fn();
    await dispatcherHook(ctx.db, { issueId, toState: 'implementing' }, { wake });
    expect(wake).not.toHaveBeenCalled();
  });
});

describe('pullNextForAgent', () => {
  it('returns next planned issue for agent ordered by priority', async () => {
    const low  = await ctx.seedIssue({ lifecycle_state: 'planned', assignee_agent_id: ctx.actors.backend, priority: 1 });
    const high = await ctx.seedIssue({ lifecycle_state: 'planned', assignee_agent_id: ctx.actors.backend, priority: 5 });
    const r = await pullNextForAgent(ctx.db, ctx.actors.backend);
    expect(r?.issueId).toBe(high);
  });
  it('returns null when agent has no assigned work', async () => {
    const r = await pullNextForAgent(ctx.db, ctx.actors.idle);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement dispatcher**

```ts
// dispatcher.ts
import type { Pool } from 'pg';
import type { LifecycleState } from '@paperclipai/shared/lifecycle-states';
import { checkBudget } from './budget-guard.js';

type WakeFn = (args: { agentId: string; issueId: string }) => Promise<{ runId: string }>;

export async function dispatcherHook(
  db: Pool,
  evt: { issueId: string; toState: LifecycleState },
  deps: { wake: WakeFn }
): Promise<{ woken: boolean; blocked?: boolean; reason?: string }> {
  if (evt.toState !== 'implementing') return { woken: false };

  const q = await db.query(
    `SELECT assignee_agent_id, repo_id FROM issues WHERE id=$1`, [evt.issueId]);
  if (q.rowCount === 0) return { woken: false, reason: 'issue not found' };
  const agentId = q.rows[0].assignee_agent_id;
  if (!agentId) return { woken: false, reason: 'no assignee' };

  const active = await db.query(
    `SELECT 1 FROM runs WHERE agent_id=$1 AND status='running' LIMIT 1`, [agentId]);
  if ((active.rowCount ?? 0) > 0) return { woken: false, reason: 'active run exists' };

  const budget = await checkBudget(db, { agentId, issueId: evt.issueId });
  if (!budget.ok) return { woken: false, blocked: true, reason: budget.reason };

  // repo mutex: no other agent implementing in same repo
  const repoId = q.rows[0].repo_id;
  if (repoId) {
    const repoBusy = await db.query(
      `SELECT 1 FROM issues
       WHERE repo_id=$1 AND lifecycle_state='implementing' AND id<>$2 LIMIT 1`,
      [repoId, evt.issueId]);
    if ((repoBusy.rowCount ?? 0) > 0) return { woken: false, reason: 'repo mutex held' };
  }

  await deps.wake({ agentId, issueId: evt.issueId });
  return { woken: true };
}

export async function pullNextForAgent(
  db: Pool, agentId: string
): Promise<{ issueId: string } | null> {
  const r = await db.query(
    `SELECT id FROM issues
     WHERE assignee_agent_id=$1 AND lifecycle_state IN ('planned','changes_requested','failed')
     ORDER BY priority DESC, created_at ASC LIMIT 1`,
    [agentId]);
  if (r.rowCount === 0) return null;
  return { issueId: r.rows[0].id };
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/dispatcher.ts server/src/services/dispatcher.test.ts
git commit -m "feat(ilm-v2): dispatcher hook + pullNext with policy gate"
```

---

## Phase 5 — API Routes

### Task 5.1: `POST /api/issues/:id/transition`

**Files:**
- Create: `server/src/routes/issues-transition.ts`

- [ ] **Step 1: Write route**

```ts
// issues-transition.ts
import { Router } from 'express';
import { z } from 'zod';
import { applyTransition } from '../services/lifecycle.js';
import { dispatcherHook } from '../services/dispatcher.js';
import { getPool } from '../db.js'; // existing helper
import { wakeAgent } from '../services/agents.js'; // existing or wrap

const Body = z.object({
  to: z.string(),
  reason: z.string().optional(),
  actor_id: z.string().uuid(),
  run_id: z.string().uuid().optional(),
  side_effects: z.object({
    spec_md: z.string().optional(),
    plan_md: z.string().optional(),
    handoff_md: z.string().optional(),
    branch: z.string().optional(),
    pr_url: z.string().url().optional(),
    blocker_reason: z.string().optional(),
  }).optional(),
});

export const issuesTransitionRouter = Router();

issuesTransitionRouter.post('/:id/transition', async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  const db = getPool();
  const r = await applyTransition(db, {
    issueId: req.params.id,
    to: parsed.data.to as any,
    actorId: parsed.data.actor_id,
    runId: parsed.data.run_id,
    reason: parsed.data.reason,
    sideEffects: parsed.data.side_effects,
  });
  if (!r.ok) return res.status(422).json({ error: r.reason });

  // Fire dispatcher hook inline (event-driven wake).
  const hookResult = await dispatcherHook(db, {
    issueId: req.params.id, toState: r.toState,
  }, { wake: wakeAgent });

  return res.json({ ok: true, from: r.fromState, to: r.toState, dispatch: hookResult });
});
```

- [ ] **Step 2: Mount in `server/src/app.ts`**

Find the place where other routes are mounted and add:

```ts
import { issuesTransitionRouter } from './routes/issues-transition.js';
// ...
if (config.FEATURE_ILM_V2) {
  app.use('/api/issues', issuesTransitionRouter);
}
```

- [ ] **Step 3: Smoke test with curl**

Start server (new terminal): `pnpm dev:server`

Then:

```bash
curl -X POST http://localhost:3100/api/issues/<some-uuid>/transition \
  -H "Content-Type: application/json" \
  -d '{"to":"spec_d","actor_id":"<ceo-uuid>","reason":"test","side_effects":{"spec_md":"# test"}}'
```

Expected: `{ok:true, from:"inbox", to:"spec_d", dispatch:{...}}`

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/issues-transition.ts server/src/app.ts
git commit -m "feat(ilm-v2): POST /api/issues/:id/transition route + hook wire-up"
```

### Task 5.2: `POST /api/agents/:id/pull-next`

**Files:**
- Create: `server/src/routes/agents-pull-next.ts`

- [ ] **Step 1: Write route**

```ts
// agents-pull-next.ts
import { Router } from 'express';
import { pullNextForAgent, dispatcherHook } from '../services/dispatcher.js';
import { getPool } from '../db.js';
import { wakeAgent } from '../services/agents.js';
import { applyTransition } from '../services/lifecycle.js';

export const agentsPullNextRouter = Router();

agentsPullNextRouter.post('/:id/pull-next', async (req, res) => {
  const db = getPool();
  const agentId = req.params.id;
  const next = await pullNextForAgent(db, agentId);
  if (!next) return res.json({ hasNext: false });

  // Transition the issue into implementing to trigger dispatcher.
  const r = await applyTransition(db, {
    issueId: next.issueId, to: 'implementing',
    actorId: agentId, reason: 'pull-queue claim',
  });
  if (!r.ok) return res.status(422).json({ error: r.reason });

  const hook = await dispatcherHook(db,
    { issueId: next.issueId, toState: 'implementing' },
    { wake: wakeAgent });
  return res.json({ hasNext: true, issueId: next.issueId, dispatch: hook });
});
```

- [ ] **Step 2: Mount and test**

Add in `app.ts` under the `FEATURE_ILM_V2` block:
```ts
import { agentsPullNextRouter } from './routes/agents-pull-next.js';
app.use('/api/agents', agentsPullNextRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/agents-pull-next.ts server/src/app.ts
git commit -m "feat(ilm-v2): POST /api/agents/:id/pull-next (queue-pull)"
```

### Task 5.3: `POST /api/budget/reset` (human only)

**Files:**
- Create: `server/src/routes/budget-reset.ts`

- [ ] **Step 1: Write route**

```ts
// budget-reset.ts
import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db.js';

const Body = z.object({
  scope: z.enum(['per_agent_daily','per_issue_total','global_daily']),
  target_id: z.string().optional(),
  reason: z.string(),
});

export const budgetResetRouter = Router();

budgetResetRouter.post('/reset', async (req, res) => {
  // Require a simple header gate. Only the human should have this token.
  if (req.header('X-Paperclip-Human-Token') !== process.env.PAPERCLIP_HUMAN_TOKEN) {
    return res.status(403).json({ error: 'human token required' });
  }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const db = getPool();
  // "Reset" == insert synthetic negative-cost adjustment row scoped to period.
  const delta = parsed.data.scope === 'global_daily' ? -999 :
                parsed.data.scope === 'per_agent_daily' ? -999 :
                parsed.data.scope === 'per_issue_total' ? -999 : 0;
  await db.query(
    `INSERT INTO heartbeat_runs (id, agent_id, issue_id, started_at, ended_at, status, usage_json)
     VALUES (gen_random_uuid(), $1, $2, now(), now(), 'budget_adjustment',
             jsonb_build_object('cost', jsonb_build_object('total', $3), 'reason', $4))`,
    [parsed.data.target_id ?? null, parsed.data.target_id ?? null, delta, parsed.data.reason]
  );
  return res.json({ ok: true, delta });
});
```

- [ ] **Step 2: Mount**

```ts
import { budgetResetRouter } from './routes/budget-reset.js';
app.use('/api/budget', budgetResetRouter);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/budget-reset.ts server/src/app.ts
git commit -m "feat(ilm-v2): human-only POST /api/budget/reset"
```

### Task 5.4: `/api/ops/*` routes (snapshot, stream, daily-report)

**Files:**
- Create: `server/src/routes/ops.ts`

- [ ] **Step 1: Write snapshot + daily-report**

```ts
// ops.ts (snapshot + daily-report; WebSocket stream in next step)
import { Router } from 'express';
import { getPool } from '../db.js';
import { CAPS } from '../services/budget-guard.js';

export const opsRouter = Router();

opsRouter.get('/snapshot', async (_req, res) => {
  const db = getPool();
  const agents = await db.query(`
    SELECT a.id, a.role, a.paused,
      (SELECT r.id FROM runs r WHERE r.agent_id=a.id AND r.status='running' LIMIT 1) AS active_run,
      COALESCE((
        SELECT SUM((usage_json->'cost'->>'total')::numeric) FROM heartbeat_runs
        WHERE agent_id=a.id
        AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
      ), 0) AS spend_today
    FROM agents a ORDER BY a.role`);
  const pipeline = await db.query(`
    SELECT lifecycle_state, COUNT(*) FROM issues
    GROUP BY lifecycle_state ORDER BY lifecycle_state`);
  const transitions = await db.query(`
    SELECT t.*, i.title FROM issue_transitions t JOIN issues i ON i.id=t.issue_id
    ORDER BY t.created_at DESC LIMIT 20`);
  res.json({ agents: agents.rows, pipeline: pipeline.rows,
             transitions: transitions.rows, caps: CAPS });
});

opsRouter.get('/daily-report', async (_req, res) => {
  const db = getPool();
  const merged = await db.query(`
    SELECT COUNT(*) AS n FROM issue_transitions
    WHERE to_state='merged'
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')`);
  const spend = await db.query(`
    SELECT COALESCE(SUM((usage_json->'cost'->>'total')::numeric), 0) AS total
    FROM heartbeat_runs
    WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')`);
  const retries = await db.query(`
    SELECT COALESCE(SUM(retry_count), 0) AS n FROM issues`);
  res.json({
    date: new Date().toISOString().slice(0, 10),
    merged_today: Number(merged.rows[0].n),
    spend_today_usd: Number(spend.rows[0].total),
    total_retries: Number(retries.rows[0].n),
  });
});
```

- [ ] **Step 2: Add WebSocket stream (simple, polls changes)**

```ts
// append to ops.ts
import { WebSocketServer } from 'ws';
import type { Server } from 'http';

export function attachOpsStream(httpServer: Server, db: any) {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/ops/stream' });
  let lastTransitionId: string | null = null;
  setInterval(async () => {
    const rows = await db.query(`
      SELECT * FROM issue_transitions
      ${lastTransitionId ? `WHERE created_at > (SELECT created_at FROM issue_transitions WHERE id='${lastTransitionId}')` : ''}
      ORDER BY created_at DESC LIMIT 5`);
    if ((rows.rowCount ?? 0) > 0) {
      lastTransitionId = rows.rows[0].id;
      wss.clients.forEach((c) => c.readyState === 1 && c.send(JSON.stringify({ transitions: rows.rows })));
    }
  }, 2000);
}
```

- [ ] **Step 3: Mount + attach stream in `app.ts`**

```ts
import { opsRouter, attachOpsStream } from './routes/ops.js';
if (config.FEATURE_ILM_V2) {
  app.use('/api/ops', opsRouter);
  // after httpServer is created:
  attachOpsStream(httpServer, getPool());
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/ops.ts server/src/app.ts
git commit -m "feat(ilm-v2): /api/ops snapshot + daily-report + WebSocket stream"
```

---

## Phase 6 — Codex Cost Tracking Fix

### Task 6.1: Usage parser

**Files:**
- Create: `packages/adapters/codex-local/src/server/parse-usage.ts`
- Create: `packages/adapters/codex-local/src/server/parse-usage.test.ts`

- [ ] **Step 1: Capture 3 real NDJSON run traces for fixtures**

```bash
ls ~/.paperclip/instances/default/data/run-logs/ | head -5
# Pick 3 recent Codex runs; copy to:
mkdir -p packages/adapters/codex-local/src/server/__fixtures__/
cp "<run-log-path-1>.ndjson" packages/adapters/codex-local/src/server/__fixtures__/codex-gpt5-4-run-1.ndjson
# repeat for 2 more
```

- [ ] **Step 2: Write failing test**

```ts
// parse-usage.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUsageFromStream } from './parse-usage.js';

const FIX = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('parseUsageFromStream', () => {
  it('extracts tokens from gpt-5.4 run', () => {
    const r = parseUsageFromStream(FIX('codex-gpt5-4-run-1.ndjson'));
    expect(r.input).toBeGreaterThan(0);
    expect(r.output).toBeGreaterThan(0);
    expect(r.model).toBe('gpt-5.4');
  });
  it('returns zeros when no usage block', () => {
    const r = parseUsageFromStream('');
    expect(r.input).toBe(0);
    expect(r.output).toBe(0);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement parser**

```ts
// parse-usage.ts
export type UsageResult = {
  input: number; output: number; cached: number; model: string;
};

export function parseUsageFromStream(ndjson: string): UsageResult {
  const lines = ndjson.split(/\r?\n/).filter(Boolean);
  let result: UsageResult = { input: 0, output: 0, cached: 0, model: '' };
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const u = obj?.usage ?? obj?.response?.usage ?? obj?.data?.usage;
      if (u) {
        result.input  += Number(u.input_tokens ?? u.prompt_tokens ?? 0);
        result.output += Number(u.output_tokens ?? u.completion_tokens ?? 0);
        result.cached += Number(u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0);
      }
      const m = obj?.model ?? obj?.response?.model;
      if (m && !result.model) result.model = String(m);
    } catch { /* ignore non-JSON lines */ }
  }
  return result;
}
```

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Wire into `execute.ts` on run finalize**

In `packages/adapters/codex-local/src/server/execute.ts`, find the place where the run result is persisted. Add:

```ts
import { parseUsageFromStream } from './parse-usage.js';
import { computeCost } from '@paperclipai/shared/pricing';
// ...
const usage = parseUsageFromStream(streamedOutput);
const cost = computeCost(
  (usage.model || 'gpt-5.4') as any,
  { input: usage.input, output: usage.output, cached: usage.cached }
);
// When writing usage_json:
usageJson = {
  ...existing,
  tokens: { input: usage.input, output: usage.output, cached: usage.cached },
  cost: { total: cost, model: usage.model || 'gpt-5.4' },
};
```

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/codex-local/src/server/parse-usage.ts \
         packages/adapters/codex-local/src/server/parse-usage.test.ts \
         packages/adapters/codex-local/src/server/__fixtures__/ \
         packages/adapters/codex-local/src/server/execute.ts
git commit -m "fix(codex-local): parse gpt-5.4 stream usage; write real cost"
```

---

## Phase 7 — Cutover (delete heartbeat, wire hook)

### Task 7.1: Locate and disable the old heartbeat loop

**Files:**
- Modify: (exact file identified in exploration step below)

- [ ] **Step 1: Find the 30s per-agent heartbeat loop**

```bash
grep -rn "setInterval\|heartbeat.*intervalMs\|30 ?\* ?1000\|30000" --include="*.ts" server/src packages/adapter-utils/src | grep -v test | head -20
```

- [ ] **Step 2: Identify the exact file + function that calls `/wakeup` on a timer**

The loop is likely in `server/src/services/` or `packages/adapter-utils/src/`. Read the relevant file and find the `setInterval` that triggers `/wakeup` calls.

- [ ] **Step 3: Gate the loop behind `!config.FEATURE_ILM_V2`**

```ts
if (!config.FEATURE_ILM_V2) {
  // existing heartbeat loop
  setInterval(heartbeatTick, 30_000);
}
```

- [ ] **Step 4: Require `payload.issueId` in `/wakeup`**

In `server/src/routes/issues-checkout-wakeup.ts` (or the wake endpoint), change the cwd-fallback path:

```ts
if (config.FEATURE_ILM_V2 && !req.body?.payload?.issueId) {
  return res.status(400).json({ error: 'payload.issueId required under FEATURE_ILM_V2' });
}
```

- [ ] **Step 5: Commit**

```bash
git add server/src/
git commit -m "feat(ilm-v2): gate heartbeat behind flag; require issueId on wake"
```

### Task 7.2: Watchdog cron

**Files:**
- Modify: `server/src/services/cron.ts`

- [ ] **Step 1: Add 5-min watchdog**

```ts
// in cron.ts setup
import { applyTransition } from './lifecycle.js';

export function registerIlmV2Watchdog(db: Pool) {
  setInterval(async () => {
    const stuck = await db.query(`
      SELECT r.id AS run_id, r.agent_id, r.issue_id
      FROM runs r
      WHERE r.status='running'
        AND r.started_at < now() - interval '20 minutes'
    `);
    for (const row of stuck.rows) {
      await db.query(`UPDATE runs SET status='timeout' WHERE id=$1`, [row.run_id]);
      await db.query(`UPDATE issues SET retry_count = retry_count + 1 WHERE id=$1`, [row.issue_id]);
      await db.query(`
        SELECT CASE WHEN retry_count >= 3 THEN
          (SELECT 1 FROM issues WHERE id=$1 AND retry_count >= 3)
        END
      `, [row.issue_id]);
      // If retry_count == 3, transition → failed
      const iq = await db.query(`SELECT retry_count, lifecycle_state FROM issues WHERE id=$1`, [row.issue_id]);
      if (iq.rows[0]?.retry_count >= 3 && iq.rows[0]?.lifecycle_state === 'implementing') {
        await applyTransition(db, {
          issueId: row.issue_id, to: 'failed',
          actorId: row.agent_id, reason: 'watchdog: no progress >20min, retries exhausted',
        });
      }
    }
  }, 5 * 60 * 1000);
}
```

- [ ] **Step 2: Register in startup code (behind flag)**

```ts
if (config.FEATURE_ILM_V2) registerIlmV2Watchdog(getPool());
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/cron.ts
git commit -m "feat(ilm-v2): 5min watchdog kills stale runs + bumps retry_count"
```

---

## Phase 8 — Agents (drafts + company seed)

### Task 8.1: Create ILM-v2 draft directory

**Files:**
- Create: `.paperclip/drafts/ILM-v2/README.md`
- Create: `.paperclip/drafts/ILM-v2/CEO/AGENTS.md`
- Create: `.paperclip/drafts/ILM-v2/CTO/AGENTS.md`
- Create: `.paperclip/drafts/ILM-v2/BackendDev/AGENTS.md`

(Drafts live in `C:\Users\ilm\.paperclip\drafts\ILM-v2\`, not inside the paperclip repo.)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p "/c/Users/ilm/.paperclip/drafts/ILM-v2/CEO" \
         "/c/Users/ilm/.paperclip/drafts/ILM-v2/CTO" \
         "/c/Users/ilm/.paperclip/drafts/ILM-v2/BackendDev"
```

- [ ] **Step 2: Write CEO AGENTS.md**

File: `~/.paperclip/drafts/ILM-v2/CEO/AGENTS.md`. Contents (full):

```md
# CEO — Tech Lead (ILM-v2)

## Mission
Drive the ILM product backlog end-to-end. Write specs, approve merges, arbitrate cross-project priorities. Never write feature code directly.

## States I operate
- `inbox → spec_d` (write spec_md)
- `pr_open → merged` (final approve + merge)
- `* → rejected` (kill bad issues)
- `review → pr_open` fallback when CTO is blocked implementing frontend >2h

## Permissions
- CAN: create issues, write spec_md, assign issues, approve PRs, trigger merge, reset retries, reset budget (with human token), re-prioritize backlog.
- CANNOT: write feature code, commit to any repo directly, bypass CTO review for non-trivial changes, approve own work (N/A since CEO doesn't implement).

## Handoff format (mandatory)
Every run ends with `handoff_md` on the issue:
```
## Handoff
- **From:** CEO
- **To:** CTO
- **Next state:** <state>
- **Summary:** <3 bullets>
- **Changed files:** <list; "none" if spec-only>
- **Tests:** N/A (CEO doesn't run tests)
- **Risks:** <1-3>
- **Blockers:** <empty | reason>
```

## Skills
- `paperclip` — query/mutate state via API
- `gsd-spec-phase` — write spec_md from issue title + description
- `gsd-discuss-phase` — brainstorm before spec

## Examples
1. **Inbox → spec_d**: issue "add coleta de playlists viral" → CEO reads, asks 2 clarifying questions via issue comment, writes spec_md with goals/non-goals/success criteria, transitions.
2. **PR merge**: CTO approved PR via `transition → pr_open`. CEO reviews the PR description + test plan, runs `gh pr merge --squash`, transitions `pr_open → merged`, closes worktree.
3. **Reject**: bot-created issue "investigate X" but X already solved → CEO transitions `* → rejected` with reason.
```

- [ ] **Step 3: Write CTO AGENTS.md**

File: `~/.paperclip/drafts/ILM-v2/CTO/AGENTS.md`. Contents:

```md
# CTO — Reviewer + Frontend (ILM-v2)

## Mission
Review every line that ships, threat-model security surfaces, and implement frontend work (React/TS). Timeshare: frontend implementation first, reviews second. Never approve own PR.

## States I operate
- `spec_d → planned` (read spec, write plan_md, set assignee)
- `planned → implementing` (only when `issue.type='frontend'`; write code myself)
- `implementing → review` (only when I implemented; writes handoff_md)
- `review → pr_open` (approve review → gh pr create)
- `review → changes_requested` (bounce back)

## Permissions
- CAN: write plan_md, implement frontend code in ilm_web/, open PRs, request changes on any PR, run security scans, flag RLS changes for review.
- CANNOT: approve PR I authored, commit to main, merge own PR, bypass RLS without `security_review=required` flag, delete issues.

## Handoff format
Same canonical format as CEO.

## Skills
- `gsd-plan-phase` — spec → plan_md with phase breakdown
- `gsd-code-review` — review PR against plan + coding standards
- `gsd-secure-phase` — threat model + mitigations check
- `engineering:code-review` — deeper code review rubric
- `frontend-design:frontend-design` — when implementing React components
- `vercel:nextjs` — Vercel/Next.js specifics

## Examples
1. **spec_d → planned** (backend issue): read spec, split into phases, write plan_md with tasks + tests, set assignee=BackendDev, transition.
2. **planned → implementing → review** (frontend issue "add dark mode toggle"): I implement in ilm_web/src/components/, run `pnpm test`, write handoff_md, push branch, transition → review.
3. **review → changes_requested**: BackendDev PR has RLS bypass in comment. I write review comment with 3 required changes, transition back to `implementing`.

## Sandbox
Use `dangerouslyBypassApprovalsAndSandbox=false` for reviews. Use `true` only when `issue.type='frontend'` and I'm implementing.
```

- [ ] **Step 4: Write BackendDev AGENTS.md**

File: `~/.paperclip/drafts/ILM-v2/BackendDev/AGENTS.md`. Contents:

```md
# BackendDev — Senior Backend + DevOps (ILM-v2)

## Mission
Implement all backend, infra, data, and security-fix work for ILM. Write tests, open branches (not PRs), hand off to CTO for review.

## States I operate
- `planned → implementing` (when `issue.type IN ('backend','devops','data','security-fix')`)
- `implementing → review` (writes handoff_md with tests, transitions)
- `* → blocked` (when stuck; writes blocker_reason)

## Permissions
- CAN: edit Python/FastAPI in ilm/, SQL migrations in supabase/migrations/, scripts/, GitHub Actions, Vercel config, ingestion scripts in ilm-coleta/.
- CANNOT: open PR directly (only push branch + transition→review), merge to main, alter RLS without `security_review=required`, commit secrets.

## Sandbox
`dangerouslyBypassApprovalsAndSandbox=true` (write enabled).

## Handoff format
Same canonical format. `Tests:` field is REQUIRED to include the command run and pass/fail counts.

## Skills
- `gsd-execute-phase` — execute plan_md task-by-task
- `supabase:supabase` — SQL/RLS/migrations
- `vercel:nextjs` — API endpoint deploys
- `systematic-debugging` — when stuck
- `test-driven-development` — before implementing

## Examples
1. **RLS migration**: CTO's plan has 3 tasks: write migration, write verifier, run on staging. I write `supabase/migrations/20260XX_*.sql`, implement verifier in `scripts/validation/`, run verifier locally, write handoff_md with test results, transition.
2. **New endpoint**: Plan says "add /artists/top-playlists endpoint returning top 10 playlists by streams for authenticated artist". I write test first in `tests/api/test_top_playlists.py`, implement endpoint, run `pytest`, push branch.
3. **Blocked**: Supabase migration fails on staging because of FK constraint. I transition `→ blocked` with `blocker_reason="migration 094 FK violation; need data cleanup on catalog_snapshots before migration can apply"`.
```

- [ ] **Step 5: Write README.md**

File: `~/.paperclip/drafts/ILM-v2/README.md`. Contents:

```md
# ILM-v2 Agents

3-agent operation replacing ILM-v1 (archived 2026-04-22).

| Role | CLI | Model | Max | Scope |
|---|---|---|---|---|
| CEO | Claude Code #1 | Opus 4.7 | 20x | Backlog + spec + merge |
| CTO | Claude Code #2 | Opus 4.7 | 20x | Plan + review + frontend |
| BackendDev | Codex | gpt-5.4 | — | Backend + DevOps + data + security |

4th slot (Cursor) reserved — no official agent CLI exists yet.

See `docs/superpowers/specs/2026-04-22-paperclip-ilm-v2-design.md` in the paperclip repo for full design.

## Starting
1. `pnpm dev:server` in paperclip repo
2. Open http://localhost:3100/ILM-v2
3. CEO seeds issues via UI; dispatcher wakes agents; watch `/ILM/ops` dashboard.

## Pause / resume
- Pause all: `POST /api/companies/<ilm-v2-id>/pause`
- Resume: `POST /api/companies/<ilm-v2-id>/resume`
- Pause single agent: `POST /api/agents/<id>/pause`
```

- [ ] **Step 6: Commit (drafts dir is OUTSIDE the repo; no git commit here — version-control separately if desired)**

(Drafts live in `C:\Users\ilm\.paperclip\drafts\` which is not a repo. No commit needed. Noted.)

### Task 8.2: Seed script for ILM-v2 company

**Files:**
- Create: `scripts/ilm-v2-seed.ts` (in paperclip repo)

- [ ] **Step 1: Read existing seed for reference**

```bash
cat scripts/seed-ilm-company.sql 2>/dev/null | head -50
cat scripts/run-ilm-project-workspaces.ts 2>/dev/null | head -50
```

- [ ] **Step 2: Write the seed script**

```ts
// scripts/ilm-v2-seed.ts
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_URL = 'postgresql://postgres@localhost:54329/paperclip';
const DRAFTS = 'C:/Users/ilm/.paperclip/drafts/ILM-v2';

async function main() {
  const db = new Pool({ connectionString: DB_URL });
  const companyId = randomUUID();

  await db.query(`
    INSERT INTO companies (id, name, slug, created_at)
    VALUES ($1, 'ILM-v2', 'ilm-v2', now())
  `, [companyId]);

  const agents = [
    { role: 'CEO', adapter: 'claude-local', model: 'claude-opus-4-7',
      env: { CLAUDE_CONFIG_DIR: 'C:/Users/ilm/.claude-paperclip' },
      agents_md: readFileSync(join(DRAFTS, 'CEO/AGENTS.md'), 'utf8'),
      sandbox: false },
    { role: 'CTO', adapter: 'claude-local', model: 'claude-opus-4-7',
      env: { CLAUDE_CONFIG_DIR: 'C:/Users/ilm/.claude-paperclip-cto' },
      agents_md: readFileSync(join(DRAFTS, 'CTO/AGENTS.md'), 'utf8'),
      sandbox: false },
    { role: 'BackendDev', adapter: 'codex-local', model: 'gpt-5.4',
      env: {},
      agents_md: readFileSync(join(DRAFTS, 'BackendDev/AGENTS.md'), 'utf8'),
      sandbox: true },
  ];

  for (const a of agents) {
    const id = randomUUID();
    await db.query(`
      INSERT INTO agents (id, company_id, role, adapter, model_id, agents_md,
                          adapter_config, paused)
      VALUES ($1, $2, $3, $4, $5, $6, $7, false)
    `, [id, companyId, a.role, a.adapter, a.model, a.agents_md,
        JSON.stringify({ env: a.env, dangerouslyBypassApprovalsAndSandbox: a.sandbox })]);
    console.log(`${a.role}: ${id}`);
  }

  console.log(`\nILM-v2 company: ${companyId}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run**

```bash
pnpm tsx scripts/ilm-v2-seed.ts
```

Expected output: 3 agent UUIDs + company UUID.

- [ ] **Step 4: Save UUIDs to drafts/ILM-v2/README.md**

Append the printed UUIDs to the README manually.

- [ ] **Step 5: Commit**

```bash
git add scripts/ilm-v2-seed.ts
git commit -m "feat(ilm-v2): seed script for 3-agent ILM-v2 company"
```

---

## Phase 9 — E2E Smoke Test

### Task 9.1: Write + run smoke test

**Files:**
- Create: `scripts/ilm-v2-smoke.ts`

- [ ] **Step 1: Write smoke**

```ts
// scripts/ilm-v2-smoke.ts
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const DB = new Pool({ connectionString: 'postgresql://postgres@localhost:54329/paperclip' });
const API = 'http://localhost:3100';
const COMPANY_ID = process.env.ILM_V2_COMPANY_ID!; // from seed output

async function tx(issueId: string, to: string, actorId: string, sideEffects?: any) {
  const res = await fetch(`${API}/api/issues/${issueId}/transition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, actor_id: actorId, reason: 'smoke', side_effects: sideEffects }),
  });
  const body = await res.json();
  console.log(`→ ${to}:`, body);
  return body;
}

async function main() {
  const issueId = randomUUID();
  const agents = await DB.query(`SELECT id, role FROM agents WHERE company_id=$1`, [COMPANY_ID]);
  const ceo = agents.rows.find(a => a.role === 'CEO').id;
  const cto = agents.rows.find(a => a.role === 'CTO').id;
  const backend = agents.rows.find(a => a.role === 'BackendDev').id;

  await DB.query(`
    INSERT INTO issues (id, company_id, title, body, lifecycle_state, priority)
    VALUES ($1, $2, 'SMOKE: print hello', 'add hello.py that prints hi', 'inbox', 5)
  `, [issueId, COMPANY_ID]);

  await tx(issueId, 'spec_d', ceo, { spec_md: '# Spec\nAdd hello.py' });
  await tx(issueId, 'planned', cto, { plan_md: '# Plan\n1. write hello.py\n2. run it' });
  await DB.query(`UPDATE issues SET assignee_agent_id=$1 WHERE id=$2`, [backend, issueId]);
  await tx(issueId, 'implementing', backend);

  console.log('Dispatcher should have woken BackendDev. Check ~/.paperclip/instances/default/data/run-logs/ for a new run.');

  await DB.end();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Start paperclip server with flag on**

Terminal 1:
```bash
FEATURE_ILM_V2=true pnpm dev:server
```

- [ ] **Step 3: Run smoke**

Terminal 2:
```bash
ILM_V2_COMPANY_ID=<uuid-from-seed> pnpm tsx scripts/ilm-v2-smoke.ts
```

Expected: 3 successful transitions. Dispatcher result `{ woken: true }` on last transition. A new Codex run appears in run-logs within 30s.

- [ ] **Step 4: Verify agent actually did work**

```bash
# Check if a worktree was created
ls C:/Users/ilm/Documents/GitHub/ilm-worktrees/ | tail -3
# Check run log
ls -t ~/.paperclip/instances/default/data/run-logs/ | head -3 | tail -1
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ilm-v2-smoke.ts
git commit -m "test(ilm-v2): e2e smoke test — inbox → implementing"
```

### Task 9.2: Full-path smoke (inbox → merged)

Extend `ilm-v2-smoke.ts` to also exercise:

- [ ] `implementing → review` (with handoff_md)
- [ ] `review → pr_open` (mock `gh pr create` or check git branch pushed)
- [ ] `pr_open → merged`
- [ ] Final assertion: `SELECT lifecycle_state FROM issues WHERE id=<smokeId>` returns `merged`

Step-by-step extension of the smoke (write, run, commit) similar to Task 9.1.

---

## Phase 10 — Ops Dashboard (UI)

### Task 10.1: Add `/ILM/ops` route to UI

**Files:**
- Create: `packages/ui-app/src/pages/IlmOps.tsx` (or equivalent UI package)
- Modify: routes file

- [ ] **Step 1: Identify the UI package and routing file**

```bash
find packages -name "App.tsx" -o -name "routes.ts" -o -name "router.ts" 2>/dev/null | grep -v node_modules | head -10
```

- [ ] **Step 2: Create the page skeleton**

```tsx
// IlmOps.tsx
import { useEffect, useState } from 'react';

type Snapshot = {
  agents: any[]; pipeline: any[]; transitions: any[]; caps: any;
};

export function IlmOps() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    const load = async () => {
      const r = await fetch('/api/ops/snapshot');
      setSnap(await r.json());
    };
    load();
    const ws = new WebSocket(`ws://${location.host}/api/ops/stream`);
    ws.onmessage = () => load();
    return () => ws.close();
  }, []);
  if (!snap) return <div>loading…</div>;
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">ILM Ops</h1>
      <section>
        <h2 className="font-semibold">Agents</h2>
        <table><thead><tr><th>Role</th><th>Paused</th><th>Active run</th><th>Spend today</th></tr></thead>
          <tbody>{snap.agents.map((a: any) => (
            <tr key={a.id}><td>{a.role}</td><td>{String(a.paused)}</td>
              <td>{a.active_run || '—'}</td>
              <td>${Number(a.spend_today).toFixed(2)}</td></tr>))}
          </tbody></table>
      </section>
      <section>
        <h2 className="font-semibold">Pipeline</h2>
        <ul>{snap.pipeline.map((p: any) => <li key={p.lifecycle_state}>{p.lifecycle_state}: {p.count}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-semibold">Last 20 transitions</h2>
        <ol>{snap.transitions.map((t: any) => (
          <li key={t.id}>{t.created_at}: <b>{t.title}</b> {t.from_state} → {t.to_state} ({t.reason})</li>))}
        </ol>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Mount route** `/ILM/ops` in the router.

- [ ] **Step 4: Build UI + verify**

```bash
pnpm --filter @paperclipai/ui build
```

Open `http://localhost:3100/ILM/ops` after restart.

- [ ] **Step 5: Commit**

```bash
git add packages/ui-app/src/
git commit -m "feat(ilm-v2): /ILM/ops dashboard (agents, pipeline, transitions)"
```

---

## Phase 11 — Flip Flag + Clean Up

### Task 11.1: Run for 24h with flag on + monitor

- [ ] **Step 1: Enable flag in `.env`**

Edit `C:/Users/ilm/.paperclip/instances/default/.env`:
```
FEATURE_ILM_V2=true
```

Restart server. Run 1 real issue end-to-end. Watch `/ILM/ops` and `~/.paperclip/instances/default/data/run-logs/`.

- [ ] **Step 2: Check budget accrual is accurate**

```sql
SELECT SUM((usage_json->'cost'->>'total')::numeric)
FROM heartbeat_runs
WHERE started_at > now() - interval '1 day';
```

Compare with OpenAI / Anthropic dashboards. Should be within 10¢.

- [ ] **Step 3: Confirm no runaway wakes**

Log count of `/wakeup` calls should be roughly proportional to real work done, not constant.

### Task 11.2: Delete old heartbeat loop permanently

Once confident:

- [ ] **Step 1: Delete the `setInterval(heartbeatTick, 30000)` block**
- [ ] **Step 2: Remove the `!config.FEATURE_ILM_V2` gate** (flag is permanent ON)
- [ ] **Step 3: `pnpm test` full suite — all pass**
- [ ] **Step 4: Commit**

```bash
git commit -am "chore(ilm-v2): remove legacy heartbeat loop; FEATURE_ILM_V2 is now default"
```

### Task 11.3: Archive ILM-v1 drafts

```bash
mv /c/Users/ilm/.paperclip/drafts/ILM-v1 /c/Users/ilm/.paperclip/drafts/ILM-v1-archived-$(date +%Y%m%d)
```

### Task 11.4: Open PR on paperclip repo (optional, if upstreaming)

```bash
gh pr create --title "feat: ILM-v2 — dispatcher, lifecycle, budget" \
  --body "$(cat docs/superpowers/specs/2026-04-22-paperclip-ilm-v2-design.md | head -80)"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Plan task |
|---|---|
| Event-driven hook | Task 4.1 (dispatcher) + Task 5.1 (route wires it) |
| Pull-queue | Task 4.1 (pullNextForAgent) + Task 5.2 (route) |
| Task lifecycle state machine | Tasks 1.1 + 2.1 + 2.3 |
| Handoff contract | Task 2.2 + validated in 2.3 |
| Budget hard-stop | Task 3.1 + 3.2 + enforced in dispatcher 4.1 |
| Codex cost fix | Task 6.1 |
| 3 AGENTS.md | Task 8.1 |
| Seed ILM-v2 company | Task 8.2 |
| /ILM/ops dashboard | Task 10.1 + routes in Task 5.4 |
| Watchdog | Task 7.2 |
| Review starvation fallback | Covered in CEO AGENTS.md under "States I operate" |
| Windows patches preserved | Untouched (not modified in any task) |
| Feature flag rollout | Tasks 0.2 + 5.x (mount gated) + 11.1/11.2 |

### Placeholder scan

- No "TBD", "TODO", "implement later" in task steps.
- Task 7.1 Step 1 says "exact file identified in exploration step below" — acceptable because Step 1 is exactly that exploration. Not a placeholder; it's a discovery step with a concrete command.

### Type consistency

- State name `spec_d` used consistently (quoted-literal in SQL, TS union, transitions).
- `wakeAgent` signature: `({agentId, issueId}) => Promise<{runId}>` in dispatcher.ts and routes.
- `handoff_md` consistent across lifecycle, handoff validator, route, agents' AGENTS.md.
- Model IDs in pricing match ones adapter uses.

### Scope

- One coherent system. No independent sub-projects. Single plan is appropriate.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-paperclip-ilm-v2.md`.**

Next step: execute tasks phase by phase. Given user's directive "não pare até me entregar todos os agentes funcionando", recommended path is **inline execution with per-phase checkpoint** (executing-plans skill) so user can intervene if a phase blows up without losing context.
