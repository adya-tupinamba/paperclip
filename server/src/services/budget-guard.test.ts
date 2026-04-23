import { describe, it, expect } from 'vitest';
import { checkBudget, CAPS, type BudgetDb } from './budget-guard.js';

/**
 * Mock `BudgetDb` that simulates `heartbeat_runs` aggregation by pattern-matching
 * the four WHERE clauses emitted by `checkBudget`. Each seeded row is scored
 * against every clause and summed into the returned `total`.
 *
 * We unit-test against a mock rather than wiring embedded-postgres because:
 *   1. `heartbeat_runs` has no `issue_id` column, so the plan's seedRunCost
 *      helper would need to stamp `usage_json->>'issue_id'` anyway.
 *   2. The SQL is pure aggregation — no stored procedures, no triggers —
 *      so behavior is fully captured by the four predicates below.
 */

type SeedRow = {
  agentId: string;
  issueId: string | null;
  cost: number;
  startedAt: Date;
};

function buildMockDb(rows: SeedRow[]): BudgetDb {
  const now = Date.now();
  const startOfDayBrt = new Date(now - (now % (24 * 60 * 60 * 1000))); // good enough for tests
  const oneHourAgo = new Date(now - 60 * 60 * 1000);

  return {
    async query<Row = { total: string | number | null }>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: Row[] }> {
      let match: (row: SeedRow) => boolean;

      if (sql.includes("agent_id=$1") && sql.includes("date_trunc('day'")) {
        const agentId = params[0] as string;
        match = (r) => r.agentId === agentId && r.startedAt >= startOfDayBrt;
      } else if (sql.includes("agent_id=$1") && sql.includes("interval '1 hour'")) {
        const agentId = params[0] as string;
        match = (r) => r.agentId === agentId && r.startedAt >= oneHourAgo;
      } else if (sql.includes("usage_json->>'issue_id' = $1")) {
        const issueId = params[0] as string;
        match = (r) => r.issueId === issueId;
      } else if (sql.includes("date_trunc('day'")) {
        match = (r) => r.startedAt >= startOfDayBrt;
      } else {
        throw new Error(`unexpected SQL: ${sql}`);
      }

      const total = rows.filter(match).reduce((acc, r) => acc + r.cost, 0);
      return { rows: [{ total } as unknown as Row] };
    },
  };
}

const AGENT = '00000000-0000-0000-0000-000000000001';
const ISSUE = '00000000-0000-0000-0000-0000000000aa';

describe('checkBudget', () => {
  it('allows when no spend', async () => {
    const db = buildMockDb([]);
    const r = await checkBudget(db, { agentId: AGENT, issueId: null });
    expect(r.ok).toBe(true);
  });

  it('blocks per-agent daily cap', async () => {
    const db = buildMockDb([
      { agentId: AGENT, issueId: null, cost: 5.01, startedAt: new Date() },
    ]);
    const r = await checkBudget(db, { agentId: AGENT, issueId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/per_agent_daily/);
  });

  it('blocks per-issue cap', async () => {
    // Keep daily-agent and hourly-agent under their caps so the per-issue
    // branch is the one that trips. Spread across two agents to dodge
    // per-agent-daily, but share the same issueId.
    const other = '00000000-0000-0000-0000-000000000002';
    const db = buildMockDb([
      { agentId: AGENT, issueId: ISSUE, cost: 0.90, startedAt: new Date() },
      { agentId: other, issueId: ISSUE, cost: 1.20, startedAt: new Date() },
    ]);
    const r = await checkBudget(db, { agentId: AGENT, issueId: ISSUE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/per_issue_total/);
  });

  it('exposes the four cap tiers', () => {
    expect(CAPS.per_agent_daily).toBe(5.00);
    expect(CAPS.per_agent_hourly).toBe(1.00);
    expect(CAPS.per_issue_total).toBe(2.00);
    expect(CAPS.global_daily).toBe(15.00);
  });
});
