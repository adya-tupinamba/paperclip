/**
 * Watchdog — ILM-v2 Phase 7 Task 7.2.
 *
 * Runs every 5 minutes. For any `heartbeat_runs` row in state `running`
 * whose `started_at` is more than 20 minutes old, the watchdog:
 *   1. Marks the run `status='timeout'` (writes finished_at, error).
 *   2. If the run has an associated `issue_id` (stamped into
 *      `context_snapshot.issueId` by the dispatcher), bumps
 *      `issues.retry_count` by 1.
 *   3. If that bump takes `retry_count >= 3` AND the issue is still
 *      in `lifecycle_state='implementing'`, transitions it to `failed`
 *      with reason `watchdog timeout` via `applyTransition` so the
 *      audit trail in `issue_transitions` is consistent with the rest
 *      of the pipeline.
 *
 * Schema notes (see `packages/db/src/schema/heartbeat_runs.ts`):
 *   - The `heartbeat_runs` table has no top-level `issue_id` column.
 *     Issue association is carried in `context_snapshot` JSON, which
 *     the dispatcher's wake flow stamps. If the field is missing we
 *     still kill the run but skip retry bookkeeping.
 *   - `retry_count` on `issues` has a `chk_issue_retry_cap CHECK (<=3)`
 *     constraint from migration 0065. We clamp the UPDATE to the same
 *     bound so a repeated watchdog tick on the same stuck issue never
 *     raises the constraint — subsequent ticks are idempotent.
 *
 * DB shape is duck-typed (`{query}` plus a `LifecycleDb`) so the service
 * works with either postgres.js or pg, and tests can pass mocks.
 */
import type { LifecycleDb } from './lifecycle.js';
import { applyTransition } from './lifecycle.js';

const STALE_AFTER_INTERVAL = "now() - interval '20 minutes'";
const WATCHDOG_TICK_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;

export interface WatchdogDb {
  query<Row = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number }>;
}

export type WatchdogTickResult = {
  killed: number;
  retriedIssues: number;
  failedIssues: number;
};

type StaleRunRow = {
  run_id: string;
  agent_id: string;
  issue_id: string | null;
};

/**
 * Run one watchdog tick. Exported separately from the timer wrapper so
 * tests and the startup recovery path can invoke it synchronously.
 */
export async function runWatchdogTick(
  db: WatchdogDb,
  lifecycleDb: LifecycleDb,
): Promise<WatchdogTickResult> {
  // Fetch stale runs. We extract `context_snapshot->>'issueId'` as the
  // best-effort issue association. Rows with no issueId still get
  // timed-out so they do not block the active-run check in the
  // dispatcher, but they are not retried.
  const stale = await db.query<StaleRunRow>(
    `SELECT id AS run_id,
            agent_id,
            (context_snapshot->>'issueId') AS issue_id
       FROM heartbeat_runs
      WHERE status = 'running'
        AND started_at < ${STALE_AFTER_INTERVAL}`,
  );

  let retriedIssues = 0;
  let failedIssues = 0;

  for (const row of stale.rows) {
    // 1. Mark the run timed-out. We don't enforce WHERE status='running'
    //    strictly again — a concurrent finish is a no-op for us.
    await db.query(
      `UPDATE heartbeat_runs
          SET status = 'timeout',
              finished_at = now(),
              error = COALESCE(error, 'watchdog timeout')
        WHERE id = $1
          AND status = 'running'`,
      [row.run_id],
    );

    if (!row.issue_id) continue;

    // 2. Bump retry_count, clamped to MAX_RETRIES to respect the CHECK.
    //    Capture the post-update value + current lifecycle_state so we
    //    can decide whether to transition to `failed`.
    const bumped = await db.query<{
      retry_count: number;
      lifecycle_state: string;
    }>(
      `UPDATE issues
          SET retry_count = LEAST(retry_count + 1, $2)
        WHERE id = $1
        RETURNING retry_count, lifecycle_state`,
      [row.issue_id, MAX_RETRIES],
    );

    if (bumped.rows.length === 0) continue;
    retriedIssues += 1;

    const { retry_count, lifecycle_state } = bumped.rows[0]!;

    // 3. If we're at the cap and still implementing, escalate to failed
    //    through the lifecycle service (audit-preserving).
    //
    //    Leaving `implementing` normally requires a handoff_md, but a
    //    watchdog-forced failure never has one (the agent process is
    //    unresponsive by definition). We synthesize a minimal handoff
    //    that satisfies `validateHandoff`'s required-fields check so
    //    the transition writes cleanly and the audit trail records
    //    that it was watchdog-driven.
    if (retry_count >= MAX_RETRIES && lifecycle_state === 'implementing') {
      const syntheticHandoff = [
        'From: watchdog',
        `To: ${row.agent_id}`,
        'Next state: failed',
        'Summary: agent run exceeded the 20m timeout 3 times in a row',
        'Changed files: n/a',
        'Tests: n/a',
      ].join('\n');
      const result = await applyTransition(lifecycleDb, {
        issueId: row.issue_id,
        to: 'failed',
        actorId: row.agent_id,
        reason: 'watchdog timeout',
        sideEffects: { handoff_md: syntheticHandoff },
      });
      if (result.ok) failedIssues += 1;
    }
  }

  return {
    killed: stale.rows.length,
    retriedIssues,
    failedIssues,
  };
}

/**
 * Register a `setInterval` watchdog loop. Returns a handle with `stop()`
 * so the server can tear the timer down cleanly on shutdown. The timer
 * is `unref`'d so it never keeps the process alive by itself.
 *
 * Mount this under `isFeatureIlmV2Enabled()` from `server/src/index.ts`
 * or wherever the top-level scheduler lives.
 */
export function registerIlmV2Watchdog(
  db: WatchdogDb,
  lifecycleDb: LifecycleDb,
  opts: {
    intervalMs?: number;
    onError?: (err: unknown) => void;
    onTick?: (result: WatchdogTickResult) => void;
  } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? WATCHDOG_TICK_MS;
  const timer = setInterval(() => {
    void runWatchdogTick(db, lifecycleDb)
      .then((res) => opts.onTick?.(res))
      .catch((err) => opts.onError?.(err));
  }, intervalMs);
  timer.unref?.();
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
