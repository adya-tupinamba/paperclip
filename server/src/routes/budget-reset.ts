/**
 * ILM-v2 — Task 5.3
 *
 * `POST /api/budget/reset` (human only)
 *
 * Gated by the `X-Paperclip-Human-Token` header matching
 * `process.env.PAPERCLIP_HUMAN_TOKEN`. Inserts a synthetic negative-cost
 * row into `heartbeat_runs` so the budget-guard aggregation (which SUMs
 * `usage_json->'cost'->>'total'`) subtracts the delta on subsequent
 * checks.
 *
 * The row carries:
 *   - `status = 'budget_adjustment'`  (no CHECK constraint on this column,
 *     so the value is accepted verbatim)
 *   - `usage_json = { cost: { total: -999 }, adjustment: true, ... }`
 *
 * Required fields on `heartbeat_runs` we satisfy:
 *   - `agent_id`      supplied by the caller as `target_agent_id`
 *   - `company_id`    looked up from the agent
 *   - `invocation_source = 'automation'` (schema default is 'manual'/'queued')
 *
 * `scope='global_daily'` with no `target_agent_id` is also supported by
 * using the first agent's company as owner — the budget-guard's global
 * aggregation is unscoped, so it will still pick up the negative row.
 */
import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { buildQueryDb } from "../services/ilm-v2-db-adapter.js";

const RESET_BODY = z.object({
  scope: z.enum(["per_agent_daily", "per_issue_total", "global_daily"]),
  target_id: z.string().optional(),
  target_agent_id: z.string().uuid().optional(),
  reason: z.string().min(1),
  delta: z.number().negative().optional(),
});

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;

export type BudgetResetDeps = {
  query?: QueryFn;
  readToken?: () => string | undefined;
};

function tokensEqual(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const e = Buffer.from(expected);
  const p = Buffer.from(provided);
  if (e.length !== p.length) return false;
  return timingSafeEqual(e, p);
}

export function budgetResetRoutes(db: Db, deps: BudgetResetDeps = {}) {
  const router = Router();
  const query: QueryFn = deps.query
    ? deps.query
    : async (sql, params) => buildQueryDb(db).query(sql, params ?? []);
  const readToken = deps.readToken ?? (() => process.env.PAPERCLIP_HUMAN_TOKEN);

  router.post("/reset", async (req, res) => {
    const expected = readToken()?.trim();
    const provided = req.header("x-paperclip-human-token")?.trim();
    if (!tokensEqual(expected, provided)) {
      res.status(403).json({ error: "human token required" });
      return;
    }

    const parsed = RESET_BODY.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const delta = body.delta ?? -999;

    // Resolve the agent + company that owns the adjustment row.
    let agentId = body.target_agent_id ?? null;
    if (!agentId && body.scope === "per_agent_daily" && body.target_id) {
      agentId = body.target_id;
    }

    let companyId: string | null = null;
    if (agentId) {
      const r = await query(
        "SELECT company_id FROM agents WHERE id=$1 LIMIT 1",
        [agentId],
      );
      if (r.rows.length === 0) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      companyId = String(r.rows[0].company_id);
    } else {
      // Global / per-issue adjustments still need an owning row; use any
      // existing agent to satisfy the NOT NULL FKs. The budget-guard's
      // aggregations filter by `agent_id=$1` (per-agent) or by
      // `usage_json->>'issue_id'` (per-issue) or not at all (global), so
      // the sentinel picks up the right adjustment.
      const r = await query("SELECT id, company_id FROM agents ORDER BY created_at ASC LIMIT 1");
      if (r.rows.length === 0) {
        res.status(422).json({ error: "no agents exist to own the adjustment row" });
        return;
      }
      agentId = String(r.rows[0].id);
      companyId = String(r.rows[0].company_id);
    }

    const usageJson: Record<string, unknown> = {
      adjustment: true,
      adjustment_scope: body.scope,
      reason: body.reason,
      cost: { total: delta },
    };
    if (body.scope === "per_issue_total" && body.target_id) {
      usageJson.issue_id = body.target_id;
    }

    const r = await query(
      `INSERT INTO heartbeat_runs
         (company_id, agent_id, invocation_source, status, started_at, finished_at, usage_json)
       VALUES ($1, $2, 'automation', 'budget_adjustment', now(), now(), $3::jsonb)
       RETURNING id`,
      [companyId, agentId, JSON.stringify(usageJson)],
    );

    res.json({
      ok: true,
      scope: body.scope,
      delta,
      adjustment_run_id: r.rows[0]?.id ?? null,
    });
  });

  return router;
}
