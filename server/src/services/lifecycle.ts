/**
 * Lifecycle transition service — ILM-v2 Phase 2 Task 2.3.
 *
 * Atomically applies a lifecycle state change to an issue:
 *   1. Opens a transaction and locks the row (`SELECT ... FOR UPDATE`).
 *   2. Validates the (from → to) pair against `isValidTransition` from
 *      `@paperclipai/shared/lifecycle-states`.
 *   3. When leaving `implementing` or `review`, requires a handoff_md that
 *      passes `validateHandoff` (either already on the row or supplied via
 *      `sideEffects.handoff_md`).
 *   4. Writes optional side-effects (spec_md, plan_md, handoff_md, branch,
 *      pr_url, blocker_reason).
 *   5. Appends a row to `issue_transitions` for audit.
 *
 * The caller passes a minimal duck-typed `LifecycleDb`. The repo's real
 * driver is `postgres` (postgres.js), not `pg`, so we cannot import
 * `pg.Pool` types directly; instead we describe the subset we use here.
 * The `connect()`-returning-a-`LifecycleClient` shape mirrors `pg.Pool`
 * semantics (BEGIN / COMMIT / ROLLBACK on a single checked-out connection)
 * and can be satisfied by a thin wrapper around either client — or a mock.
 */
import { isValidTransition, type LifecycleState } from '@paperclipai/shared';
import { validateHandoff } from './handoff.js';

export type TransitionInput = {
  issueId: string;
  to: LifecycleState;
  actorId: string;
  runId?: string;
  reason?: string;
  sideEffects?: {
    spec_md?: string;
    plan_md?: string;
    handoff_md?: string;
    branch?: string;
    pr_url?: string;
    blocker_reason?: string;
  };
};

export type TransitionResult =
  | { ok: true; fromState: LifecycleState; toState: LifecycleState }
  | { ok: false; reason: string };

export interface LifecycleClient {
  query<Row = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number }>;
  release(): void;
}

export interface LifecycleDb {
  connect(): Promise<LifecycleClient>;
}

const EXIT_REQUIRES_HANDOFF: readonly LifecycleState[] = ['implementing', 'review'];
const SIDE_EFFECT_COLUMNS = [
  'spec_md',
  'plan_md',
  'handoff_md',
  'branch',
  'pr_url',
  'blocker_reason',
] as const;

export async function applyTransition(
  db: LifecycleDb,
  input: TransitionInput,
): Promise<TransitionResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query<{
      lifecycle_state: LifecycleState;
      handoff_md: string | null;
    }>(
      'SELECT lifecycle_state, handoff_md FROM issues WHERE id=$1 FOR UPDATE',
      [input.issueId],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'issue not found' };
    }

    const fromState = cur.rows[0]!.lifecycle_state;
    if (!isValidTransition(fromState, input.to)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: `invalid transition ${fromState} → ${input.to}`,
      };
    }

    const newHandoff =
      input.sideEffects?.handoff_md ?? cur.rows[0]!.handoff_md ?? null;
    if (EXIT_REQUIRES_HANDOFF.includes(fromState)) {
      const v = validateHandoff(newHandoff);
      if (!v.ok) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          reason: `handoff_md required leaving ${fromState}: ${v.reason}`,
        };
      }
    }

    const sets: string[] = ['lifecycle_state=$1'];
    const vals: unknown[] = [input.to];
    let i = 2;
    const se = input.sideEffects ?? {};
    for (const key of SIDE_EFFECT_COLUMNS) {
      const value = se[key];
      if (value !== undefined) {
        sets.push(`${key}=$${i}`);
        vals.push(value);
        i += 1;
      }
    }
    vals.push(input.issueId);
    await client.query(
      `UPDATE issues SET ${sets.join(', ')} WHERE id=$${i}`,
      vals,
    );

    await client.query(
      `INSERT INTO issue_transitions
         (issue_id, from_state, to_state, actor_id, run_id, reason, handoff_md)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.issueId,
        fromState,
        input.to,
        input.actorId,
        input.runId ?? null,
        input.reason ?? null,
        newHandoff ?? null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, fromState, toState: input.to };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow secondary rollback failure; rethrow original
    }
    throw err;
  } finally {
    client.release();
  }
}
