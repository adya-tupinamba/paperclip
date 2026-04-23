/**
 * Dispatcher — ILM-v2 Phase 4 Task 4.1.
 *
 * Two responsibilities:
 *   1. `dispatcherHook`: event-driven wake. Called when an issue transitions.
 *      Acts only for `toState === 'implementing'`. Checks the assignee has
 *      no active heartbeat_run, the budget is clean, and no other issue in
 *      the same project is already implementing (repo mutex). On pass,
 *      invokes `wake({agentId, issueId})` and returns `{woken: true}`.
 *   2. `pullNextForAgent`: pull-queue. Returns the next issue assigned to
 *      `agentId` in state `planned|changes_requested|failed`, ordered by
 *      `priority DESC, created_at ASC`.
 *
 * NOTE — schema adaptations from the plan:
 *   - The plan references `assignee_id` → real column is `assignee_agent_id`.
 *   - The plan references `runs(agent_id, status)` → real table is
 *     `heartbeat_runs(agent_id, status)` (no issue_id column on it).
 *   - The plan references `issues.repo_id` → no such column; the closest
 *     available grouping is `project_id`, which we use as the repo-mutex
 *     key. Future work could swap in a real repo identifier.
 *
 * DB shape is duck-typed so the service works with either postgres.js or
 * pg, and so tests can pass a mock.
 */
import type { LifecycleState } from '@paperclipai/shared';
import { checkBudget, type BudgetDb } from './budget-guard.js';

export interface DispatcherDb extends BudgetDb {
  query<Row = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number }>;
}

export type WakeFn = (args: {
  agentId: string;
  issueId: string;
}) => Promise<{ runId: string } | void>;

export type DispatcherHookResult = {
  woken: boolean;
  blocked?: boolean;
  reason?: string;
};

export async function dispatcherHook(
  db: DispatcherDb,
  evt: { issueId: string; toState: LifecycleState },
  deps: { wake: WakeFn },
): Promise<DispatcherHookResult> {
  if (evt.toState !== 'implementing') {
    return { woken: false };
  }

  const q = await db.query<{
    assignee_agent_id: string | null;
    project_id: string | null;
  }>(
    'SELECT assignee_agent_id, project_id FROM issues WHERE id=$1',
    [evt.issueId],
  );
  if (q.rows.length === 0) {
    return { woken: false, reason: 'issue not found' };
  }
  const agentId = q.rows[0]!.assignee_agent_id;
  if (!agentId) {
    return { woken: false, reason: 'no assignee' };
  }

  // Active-run check — heartbeat_runs has no issue_id column; scope by agent.
  const active = await db.query<{ one: number }>(
    "SELECT 1 AS one FROM heartbeat_runs WHERE agent_id=$1 AND status='running' LIMIT 1",
    [agentId],
  );
  if (active.rows.length > 0) {
    return { woken: false, reason: 'active run exists' };
  }

  const budget = await checkBudget(db, { agentId, issueId: evt.issueId });
  if (!budget.ok) {
    return { woken: false, blocked: true, reason: budget.reason };
  }

  // Repo mutex via project_id: only one issue per project may be implementing.
  const projectId = q.rows[0]!.project_id;
  if (projectId) {
    const busy = await db.query<{ one: number }>(
      `SELECT 1 AS one FROM issues
       WHERE project_id=$1 AND lifecycle_state='implementing' AND id<>$2
       LIMIT 1`,
      [projectId, evt.issueId],
    );
    if (busy.rows.length > 0) {
      return { woken: false, reason: 'repo mutex held' };
    }
  }

  await deps.wake({ agentId, issueId: evt.issueId });
  return { woken: true };
}

export async function pullNextForAgent(
  db: DispatcherDb,
  agentId: string,
): Promise<{ issueId: string } | null> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM issues
     WHERE assignee_agent_id=$1
       AND lifecycle_state IN ('planned','changes_requested','failed')
     ORDER BY priority DESC, created_at ASC
     LIMIT 1`,
    [agentId],
  );
  if (r.rows.length === 0) return null;
  return { issueId: r.rows[0]!.id };
}
