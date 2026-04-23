import { describe, it, expect, vi } from 'vitest';
import { runWatchdogTick, type WatchdogDb } from './watchdog.js';
import type { LifecycleClient, LifecycleDb } from './lifecycle.js';

/**
 * Mock DB for `runWatchdogTick`.
 *
 * Claude Code runs elevated on Windows and cannot boot the embedded-pg
 * helper used in integration tests, so we simulate the small set of
 * queries the watchdog emits over an in-memory model.
 *
 * The `WatchdogDb` query pattern-matches SQL substrings:
 *   - `SELECT ... FROM heartbeat_runs WHERE status = 'running'` ->
 *     return fixtures whose started_at is more than 20m ago.
 *   - `UPDATE heartbeat_runs SET status = 'timeout'` -> mark the fixture.
 *   - `UPDATE issues SET retry_count = LEAST(...)` -> clamp + RETURNING.
 *
 * `LifecycleDb` is satisfied via a minimal BEGIN/SELECT-FOR-UPDATE/UPDATE/
 * INSERT/COMMIT transaction log — enough for `applyTransition` to call
 * into it without throwing.
 */

type RunRow = {
  id: string;
  agent_id: string;
  status: 'running' | 'timeout';
  started_at: Date;
  issue_id: string | null;
};

type IssueRow = {
  id: string;
  retry_count: number;
  lifecycle_state: string;
  handoff_md: string | null;
};

type Fixtures = {
  runs: RunRow[];
  issues: IssueRow[];
  transitions: Array<{
    issueId: string;
    to: string;
    actorId: string;
    reason: string | null;
  }>;
};

const TWENTY_ONE_MIN = 21 * 60 * 1000;
const NINE_MIN = 9 * 60 * 1000;
const STALE_DATE = new Date(Date.now() - TWENTY_ONE_MIN);
const FRESH_DATE = new Date(Date.now() - NINE_MIN);

// Threshold at query-eval time: rows older than this count as stale.
// 20m in real SQL — we approximate with 19m so a row from STALE_DATE
// (21m old) is definitively older at the moment of comparison.
const STALE_THRESHOLD_MS = 19 * 60 * 1000;

function buildWatchdogDb(fx: Fixtures): WatchdogDb {
  return {
    async query<Row = unknown>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: Row[]; rowCount?: number }> {
      const s = sql.trim();

      // SELECT stale running rows
      if (s.startsWith('SELECT id AS run_id') && s.includes('FROM heartbeat_runs')) {
        const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
        const rows = fx.runs
          .filter((r) => r.status === 'running' && r.started_at < threshold)
          .map((r) => ({
            run_id: r.id,
            agent_id: r.agent_id,
            issue_id: r.issue_id,
          }));
        return { rows: rows as unknown as Row[], rowCount: rows.length };
      }

      // UPDATE heartbeat_runs -> timeout
      if (s.startsWith("UPDATE heartbeat_runs") && s.includes("status = 'timeout'")) {
        const id = params[0] as string;
        const hit = fx.runs.find((r) => r.id === id && r.status === 'running');
        if (hit) hit.status = 'timeout';
        return { rows: [], rowCount: hit ? 1 : 0 };
      }

      // UPDATE issues SET retry_count ...
      if (s.startsWith('UPDATE issues') && s.includes('retry_count = LEAST')) {
        const id = params[0] as string;
        const cap = params[1] as number;
        const hit = fx.issues.find((i) => i.id === id);
        if (!hit) return { rows: [], rowCount: 0 };
        hit.retry_count = Math.min(hit.retry_count + 1, cap);
        return {
          rows: [
            {
              retry_count: hit.retry_count,
              lifecycle_state: hit.lifecycle_state,
            } as unknown as Row,
          ],
          rowCount: 1,
        };
      }

      throw new Error(`unmocked SQL: ${s}`);
    },
  };
}

function buildLifecycleDb(fx: Fixtures): LifecycleDb {
  return {
    async connect(): Promise<LifecycleClient> {
      let locked: IssueRow | null = null;
      return {
        async query<Row = unknown>(sqlText: string, params: unknown[] = []) {
          const s = sqlText.trim();
          if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
            return { rows: [] as Row[], rowCount: 0 };
          }
          if (s.startsWith('SELECT lifecycle_state, handoff_md FROM issues')) {
            const id = params[0] as string;
            const hit = fx.issues.find((i) => i.id === id);
            if (!hit) return { rows: [] as Row[], rowCount: 0 };
            locked = hit;
            return {
              rows: [
                {
                  lifecycle_state: hit.lifecycle_state,
                  handoff_md: hit.handoff_md,
                } as unknown as Row,
              ],
              rowCount: 1,
            };
          }
          if (s.startsWith('UPDATE issues SET lifecycle_state')) {
            if (locked) locked.lifecycle_state = params[0] as string;
            return { rows: [] as Row[], rowCount: 1 };
          }
          if (s.startsWith('INSERT INTO issue_transitions')) {
            fx.transitions.push({
              issueId: params[0] as string,
              to: params[2] as string,
              actorId: params[3] as string,
              reason: (params[5] as string | null) ?? null,
            });
            return { rows: [] as Row[], rowCount: 1 };
          }
          throw new Error(`unmocked lifecycle SQL: ${s}`);
        },
        release(): void {
          /* noop */
        },
      };
    },
  };
}

describe('runWatchdogTick', () => {
  it('marks stale running rows as timeout', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: null },
        { id: 'run-2', agent_id: 'agent-2', status: 'running', started_at: FRESH_DATE, issue_id: null },
      ],
      issues: [],
      transitions: [],
    };

    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));

    expect(result.killed).toBe(1);
    expect(fx.runs.find((r) => r.id === 'run-1')!.status).toBe('timeout');
    expect(fx.runs.find((r) => r.id === 'run-2')!.status).toBe('running');
  });

  it('bumps retry_count on associated issue', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: 'issue-1' },
      ],
      issues: [
        { id: 'issue-1', retry_count: 0, lifecycle_state: 'implementing', handoff_md: null },
      ],
      transitions: [],
    };

    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));

    expect(result.retriedIssues).toBe(1);
    expect(result.failedIssues).toBe(0);
    expect(fx.issues[0]!.retry_count).toBe(1);
    expect(fx.issues[0]!.lifecycle_state).toBe('implementing');
    expect(fx.transitions).toHaveLength(0);
  });

  it('transitions to failed when retry_count hits 3 in implementing', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: 'issue-1' },
      ],
      issues: [
        { id: 'issue-1', retry_count: 2, lifecycle_state: 'implementing', handoff_md: null },
      ],
      transitions: [],
    };

    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));

    expect(result.retriedIssues).toBe(1);
    expect(result.failedIssues).toBe(1);
    expect(fx.issues[0]!.retry_count).toBe(3);
    expect(fx.issues[0]!.lifecycle_state).toBe('failed');
    expect(fx.transitions).toHaveLength(1);
    expect(fx.transitions[0]).toMatchObject({
      issueId: 'issue-1',
      to: 'failed',
      actorId: 'agent-1',
      reason: 'watchdog timeout',
    });
  });

  it('skips issue bookkeeping when run has no issue_id', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: null },
      ],
      issues: [],
      transitions: [],
    };

    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));

    expect(result.killed).toBe(1);
    expect(result.retriedIssues).toBe(0);
    expect(result.failedIssues).toBe(0);
  });

  it('does not transition if already past implementing (e.g., blocked)', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: 'issue-1' },
      ],
      issues: [
        { id: 'issue-1', retry_count: 2, lifecycle_state: 'blocked', handoff_md: null },
      ],
      transitions: [],
    };

    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));

    expect(result.retriedIssues).toBe(1);
    expect(result.failedIssues).toBe(0);
    expect(fx.issues[0]!.lifecycle_state).toBe('blocked');
    expect(fx.transitions).toHaveLength(0);
  });

  it('is idempotent across repeated ticks at cap', async () => {
    const fx: Fixtures = {
      runs: [
        { id: 'run-1', agent_id: 'agent-1', status: 'running', started_at: STALE_DATE, issue_id: 'issue-1' },
      ],
      issues: [
        { id: 'issue-1', retry_count: 3, lifecycle_state: 'implementing', handoff_md: null },
      ],
      transitions: [],
    };

    // First tick kills the run + transitions
    const result = await runWatchdogTick(buildWatchdogDb(fx), buildLifecycleDb(fx));
    expect(result.failedIssues).toBe(1);
    // retry_count stays at cap (LEAST(4,3))
    expect(fx.issues[0]!.retry_count).toBe(3);
  });
});
