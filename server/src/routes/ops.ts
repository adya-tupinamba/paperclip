/**
 * ILM-v2 — Task 5.4
 *
 * `/api/ops/*` surface for the human's status dashboard.
 *
 *   GET /api/ops/snapshot       — agents (with active_run_id + spend_today),
 *                                  pipeline (issue counts by lifecycle_state),
 *                                  last 20 transitions (joined with issue.title),
 *                                  and the budget CAPS.
 *   GET /api/ops/daily-report   — merged_today, spend_today_usd, total_retries
 *                                  for today (America/Sao_Paulo).
 *
 * TODO(ilm-v2): WebSocket stream at /api/ops/stream — deferred. Would
 * need to thread the http.Server through app.ts which is awkward right
 * now. Snapshot-polling at 2s from the dashboard is fine for MVP.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { CAPS } from "../services/budget-guard.js";
import { buildQueryDb } from "../services/ilm-v2-db-adapter.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;

export type OpsDeps = {
  query?: QueryFn;
};

export function opsRoutes(db: Db, deps: OpsDeps = {}) {
  const router = Router();
  const query: QueryFn = deps.query
    ? deps.query
    : async (sql, params) => buildQueryDb(db).query(sql, params ?? []);

  router.get("/snapshot", async (_req, res) => {
    const agents = await query(`
      SELECT
        a.id,
        a.name,
        a.role,
        a.status,
        a.pause_reason,
        (SELECT r.id FROM heartbeat_runs r
           WHERE r.agent_id = a.id AND r.status = 'running'
           ORDER BY r.started_at DESC NULLS LAST LIMIT 1) AS active_run_id,
        COALESCE((
          SELECT SUM((
            COALESCE(
              usage_json->>'costUsd',
              usage_json->'cost'->>'total'
            )
          )::numeric)
          FROM heartbeat_runs
          WHERE agent_id = a.id
            AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
        ), 0) AS spend_today
      FROM agents a
      ORDER BY a.role, a.name
    `);
    const pipeline = await query(`
      SELECT lifecycle_state, COUNT(*)::int AS count
      FROM issues
      GROUP BY lifecycle_state
      ORDER BY lifecycle_state
    `);
    const transitions = await query(`
      SELECT t.id, t.issue_id, t.from_state, t.to_state, t.actor_id,
             t.run_id, t.reason, t.created_at, i.title
      FROM issue_transitions t
      JOIN issues i ON i.id = t.issue_id
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    res.json({
      agents: agents.rows.map((r) => ({
        ...r,
        spend_today: Number(r.spend_today ?? 0),
      })),
      pipeline: pipeline.rows.map((r) => ({
        lifecycle_state: r.lifecycle_state,
        count: Number(r.count ?? 0),
      })),
      transitions: transitions.rows,
      caps: CAPS,
    });
  });

  router.get("/daily-report", async (_req, res) => {
    const merged = await query(`
      SELECT COUNT(*)::int AS n
      FROM issue_transitions
      WHERE to_state = 'merged'
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
    `);
    const spend = await query(`
      SELECT COALESCE(SUM((
        COALESCE(
          usage_json->>'costUsd',
          usage_json->'cost'->>'total'
        )
      )::numeric), 0) AS total
      FROM heartbeat_runs
      WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
    `);
    const retries = await query(`
      SELECT COALESCE(SUM(retry_count), 0)::int AS n
      FROM issues
    `);

    res.json({
      date: new Date().toISOString().slice(0, 10),
      merged_today: Number(merged.rows[0]?.n ?? 0),
      spend_today_usd: Number(spend.rows[0]?.total ?? 0),
      total_retries: Number(retries.rows[0]?.n ?? 0),
    });
  });

  return router;
}
