import { describe, it, expect, vi } from 'vitest';
import {
  dispatcherHook,
  pullNextForAgent,
  type DispatcherDb,
} from './dispatcher.js';

/**
 * Mock DB for dispatcher tests.
 *
 * Claude Code runs elevated on Windows and cannot start embedded-postgres,
 * so we simulate the small set of queries dispatcher/budget-guard emit.
 * The mock pattern-matches on SQL substrings and answers from in-memory
 * fixtures. It satisfies both `DispatcherDb` and the `BudgetDb` interface
 * via shared `query`.
 */

type IssueFixture = {
  id: string;
  assignee_agent_id: string | null;
  project_id: string | null;
  lifecycle_state: string;
  priority: string | number;
  created_at: string;
};

type RunFixture = {
  agent_id: string;
  issue_id: string | null;
  status: string;
  cost: number;
  started_at: Date;
};

type Fixtures = {
  issues: IssueFixture[];
  runs: RunFixture[];
};

function buildMockDb(fx: Fixtures): DispatcherDb {
  return {
    async query<Row = unknown>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: Row[]; rowCount?: number }> {
      const s = sql.trim();

      // Dispatcher: fetch issue
      if (s.startsWith('SELECT assignee_agent_id, project_id FROM issues')) {
        const id = params[0] as string;
        const row = fx.issues.find((i) => i.id === id);
        if (!row) return { rows: [] as Row[], rowCount: 0 };
        return {
          rows: [
            {
              assignee_agent_id: row.assignee_agent_id,
              project_id: row.project_id,
            } as unknown as Row,
          ],
          rowCount: 1,
        };
      }

      // Dispatcher: active run on agent
      if (s.includes('FROM heartbeat_runs') && s.includes('agent_id=$1') && s.includes("status='running'")) {
        const agentId = params[0] as string;
        const hit = fx.runs.find(
          (r) => r.agent_id === agentId && r.status === 'running',
        );
        return hit
          ? { rows: [{ one: 1 } as unknown as Row], rowCount: 1 }
          : { rows: [] as Row[], rowCount: 0 };
      }

      // Dispatcher: repo mutex (project-scoped)
      if (s.includes('FROM issues') && s.includes("lifecycle_state='implementing'") && s.includes('project_id=$1')) {
        const projectId = params[0] as string;
        const excludeId = params[1] as string;
        const hit = fx.issues.find(
          (i) =>
            i.project_id === projectId &&
            i.lifecycle_state === 'implementing' &&
            i.id !== excludeId,
        );
        return hit
          ? { rows: [{ one: 1 } as unknown as Row], rowCount: 1 }
          : { rows: [] as Row[], rowCount: 0 };
      }

      // pullNextForAgent
      if (s.includes('SELECT id FROM issues') && s.includes('assignee_agent_id=$1') && s.includes('ORDER BY priority')) {
        const agentId = params[0] as string;
        const eligible = fx.issues
          .filter(
            (i) =>
              i.assignee_agent_id === agentId &&
              ['planned', 'changes_requested', 'failed'].includes(
                i.lifecycle_state,
              ),
          )
          .sort((a, b) => {
            const pa = typeof a.priority === 'number' ? a.priority : Number(a.priority) || 0;
            const pb = typeof b.priority === 'number' ? b.priority : Number(b.priority) || 0;
            if (pb !== pa) return pb - pa;
            return a.created_at.localeCompare(b.created_at);
          });
        if (eligible.length === 0) return { rows: [] as Row[], rowCount: 0 };
        return {
          rows: [{ id: eligible[0]!.id } as unknown as Row],
          rowCount: 1,
        };
      }

      // Budget guard aggregations on heartbeat_runs
      if (s.includes('FROM heartbeat_runs') && s.includes("SUM((usage_json->'cost'->>'total')")) {
        let total = 0;
        const now = Date.now();
        const startOfDay = new Date(now - (now % (24 * 60 * 60 * 1000)));
        const oneHourAgo = new Date(now - 60 * 60 * 1000);

        if (s.includes("agent_id=$1") && s.includes("date_trunc('day'")) {
          const agentId = params[0] as string;
          total = fx.runs
            .filter((r) => r.agent_id === agentId && r.started_at >= startOfDay)
            .reduce((a, r) => a + r.cost, 0);
        } else if (s.includes('agent_id=$1') && s.includes("interval '1 hour'")) {
          const agentId = params[0] as string;
          total = fx.runs
            .filter((r) => r.agent_id === agentId && r.started_at >= oneHourAgo)
            .reduce((a, r) => a + r.cost, 0);
        } else if (s.includes("usage_json->>'issue_id' = $1")) {
          const issueId = params[0] as string;
          total = fx.runs
            .filter((r) => r.issue_id === issueId)
            .reduce((a, r) => a + r.cost, 0);
        } else if (s.includes("date_trunc('day'")) {
          total = fx.runs
            .filter((r) => r.started_at >= startOfDay)
            .reduce((a, r) => a + r.cost, 0);
        }
        return { rows: [{ total } as unknown as Row], rowCount: 1 };
      }

      throw new Error(`unexpected SQL: ${s}`);
    },
  };
}

const AGENT = '00000000-0000-0000-0000-0000000000a1';
const IDLE_AGENT = '00000000-0000-0000-0000-0000000000a2';
const PROJECT = '00000000-0000-0000-0000-0000000000c1';
const ISSUE = '00000000-0000-0000-0000-0000000000b1';
const OTHER_ISSUE = '00000000-0000-0000-0000-0000000000b2';

describe('dispatcherHook', () => {
  it('wakes agent when issue enters implementing and budget is clean', async () => {
    const db = buildMockDb({
      issues: [
        {
          id: ISSUE,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 3,
          created_at: '2026-04-22T00:00:00Z',
        },
      ],
      runs: [],
    });
    const wake = vi.fn(async () => ({ runId: 'r1' }));
    const r = await dispatcherHook(
      db,
      { issueId: ISSUE, toState: 'implementing' },
      { wake },
    );
    expect(r.woken).toBe(true);
    expect(wake).toHaveBeenCalledWith({ agentId: AGENT, issueId: ISSUE });
  });

  it('does not wake when per_agent_daily budget exceeded', async () => {
    const db = buildMockDb({
      issues: [
        {
          id: ISSUE,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 3,
          created_at: '2026-04-22T00:00:00Z',
        },
      ],
      runs: [
        {
          agent_id: AGENT,
          issue_id: null,
          status: 'completed',
          cost: 5.5,
          started_at: new Date(),
        },
      ],
    });
    const wake = vi.fn();
    const r = await dispatcherHook(
      db,
      { issueId: ISSUE, toState: 'implementing' },
      { wake },
    );
    expect(wake).not.toHaveBeenCalled();
    expect(r.woken).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/per_agent_daily/);
  });

  it('does not wake when agent already has an active heartbeat_run', async () => {
    const db = buildMockDb({
      issues: [
        {
          id: ISSUE,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 3,
          created_at: '2026-04-22T00:00:00Z',
        },
      ],
      runs: [
        {
          agent_id: AGENT,
          issue_id: null,
          status: 'running',
          cost: 0,
          started_at: new Date(),
        },
      ],
    });
    const wake = vi.fn();
    const r = await dispatcherHook(
      db,
      { issueId: ISSUE, toState: 'implementing' },
      { wake },
    );
    expect(wake).not.toHaveBeenCalled();
    expect(r.woken).toBe(false);
    expect(r.reason).toMatch(/active run/);
  });

  it('does not wake when repo mutex (project) is held by another implementing issue', async () => {
    const db = buildMockDb({
      issues: [
        {
          id: ISSUE,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 3,
          created_at: '2026-04-22T00:00:00Z',
        },
        {
          id: OTHER_ISSUE,
          assignee_agent_id: IDLE_AGENT,
          project_id: PROJECT,
          lifecycle_state: 'implementing',
          priority: 3,
          created_at: '2026-04-21T00:00:00Z',
        },
      ],
      runs: [],
    });
    const wake = vi.fn();
    const r = await dispatcherHook(
      db,
      { issueId: ISSUE, toState: 'implementing' },
      { wake },
    );
    expect(wake).not.toHaveBeenCalled();
    expect(r.woken).toBe(false);
    expect(r.reason).toMatch(/repo mutex/);
  });

  it('no-ops when toState is not implementing', async () => {
    const db = buildMockDb({ issues: [], runs: [] });
    const wake = vi.fn();
    const r = await dispatcherHook(
      db,
      { issueId: ISSUE, toState: 'spec_d' },
      { wake },
    );
    expect(r.woken).toBe(false);
    expect(wake).not.toHaveBeenCalled();
  });
});

describe('pullNextForAgent', () => {
  it('returns highest-priority planned issue for agent', async () => {
    const low = '00000000-0000-0000-0000-000000000001';
    const high = '00000000-0000-0000-0000-000000000002';
    const db = buildMockDb({
      issues: [
        {
          id: low,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 1,
          created_at: '2026-04-22T00:00:00Z',
        },
        {
          id: high,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'planned',
          priority: 5,
          created_at: '2026-04-22T01:00:00Z',
        },
      ],
      runs: [],
    });
    const r = await pullNextForAgent(db, AGENT);
    expect(r?.issueId).toBe(high);
  });

  it('returns null when agent has no eligible work', async () => {
    const db = buildMockDb({
      issues: [
        {
          id: ISSUE,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'merged',
          priority: 5,
          created_at: '2026-04-22T00:00:00Z',
        },
      ],
      runs: [],
    });
    const r = await pullNextForAgent(db, IDLE_AGENT);
    expect(r).toBeNull();
  });

  it('includes changes_requested and failed states', async () => {
    const cr = '00000000-0000-0000-0000-000000000011';
    const fl = '00000000-0000-0000-0000-000000000012';
    const db = buildMockDb({
      issues: [
        {
          id: cr,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'changes_requested',
          priority: 2,
          created_at: '2026-04-22T00:00:00Z',
        },
        {
          id: fl,
          assignee_agent_id: AGENT,
          project_id: PROJECT,
          lifecycle_state: 'failed',
          priority: 4,
          created_at: '2026-04-22T01:00:00Z',
        },
      ],
      runs: [],
    });
    const r = await pullNextForAgent(db, AGENT);
    expect(r?.issueId).toBe(fl); // higher priority
  });
});
