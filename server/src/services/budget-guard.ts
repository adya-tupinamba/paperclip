/**
 * Budget guard — ILM-v2 Phase 3 Task 3.2.
 *
 * Aggregates agent spend from `heartbeat_runs.usage_json.costUsd` (the
 * canonical flat key written by every adapter — codex-local, claude-local,
 * pi-local, cursor-local, gemini-local) and returns `{ok: false}` when any
 * of four tiers are exceeded:
 *   - per_agent_daily  ($5.00 / America/Sao_Paulo day / agent)
 *   - per_agent_hourly ($1.00 / rolling hour / agent)
 *   - per_issue_total  ($2.00 total across an issue's lifetime)
 *   - global_daily     ($15.00 / America/Sao_Paulo day / all agents)
 *
 * `issue_id` scoping note: the `heartbeat_runs` table has no top-level
 * `issue_id` column in the current schema — see
 * `packages/db/src/schema/heartbeat_runs.ts`. The plan's SQL uses
 * `WHERE issue_id=$1`; to stay within `server/src/services/` without
 * touching migrations, we key on `usage_json->>'issue_id'` instead.
 * Writers that want per-issue cap enforcement must stamp the issue id
 * into `usage_json.issue_id` when recording runs.
 *
 * The fn takes a minimal duck-typed `BudgetDb` (subset of `pg.Pool.query`)
 * so tests can pass a mock and callers can wrap whichever postgres client
 * they use.
 */

export const CAPS = {
  per_agent_daily: 5.00,
  per_agent_hourly: 1.00,
  per_issue_total: 2.00,
  global_daily: 15.00,
} as const;

export type BudgetResult = { ok: true } | { ok: false; reason: string };

export interface BudgetDb {
  query<Row = { total: string | number | null }>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export async function checkBudget(
  db: BudgetDb,
  args: { agentId: string; issueId: string | null },
): Promise<BudgetResult> {
  const { agentId, issueId } = args;

  const dailyAgent = await sumCost(
    db,
    "WHERE agent_id=$1 AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')",
    [agentId],
  );
  if (dailyAgent > CAPS.per_agent_daily) {
    return {
      ok: false,
      reason: `per_agent_daily exceeded ($${dailyAgent.toFixed(2)} > $${CAPS.per_agent_daily})`,
    };
  }

  const hourlyAgent = await sumCost(
    db,
    "WHERE agent_id=$1 AND started_at >= now() - interval '1 hour'",
    [agentId],
  );
  if (hourlyAgent > CAPS.per_agent_hourly) {
    return {
      ok: false,
      reason: `per_agent_hourly exceeded ($${hourlyAgent.toFixed(2)})`,
    };
  }

  if (issueId) {
    const issueTotal = await sumCost(
      db,
      "WHERE usage_json->>'issue_id' = $1",
      [issueId],
    );
    if (issueTotal > CAPS.per_issue_total) {
      return {
        ok: false,
        reason: `per_issue_total exceeded ($${issueTotal.toFixed(2)})`,
      };
    }
  }

  const dailyGlobal = await sumCost(
    db,
    "WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')",
    [],
  );
  if (dailyGlobal > CAPS.global_daily) {
    return {
      ok: false,
      reason: `global_daily exceeded ($${dailyGlobal.toFixed(2)})`,
    };
  }

  return { ok: true };
}

async function sumCost(
  db: BudgetDb,
  where: string,
  params: unknown[],
): Promise<number> {
  // Prefer the canonical `costUsd` key; fall back to the legacy nested
  // `cost.total` path so pre-existing budget-adjustment rows still offset
  // the running total after this fix lands.
  const sql = `SELECT COALESCE(SUM((
                 COALESCE(
                   usage_json->>'costUsd',
                   usage_json->'cost'->>'total'
                 )
               )::numeric), 0) AS total
               FROM heartbeat_runs ${where}`;
  const r = await db.query<{ total: string | number | null }>(sql, params);
  const raw = r.rows[0]?.total ?? 0;
  return Number(raw);
}
