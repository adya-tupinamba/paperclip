import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { budgetResetRoutes } from "../routes/budget-reset.js";

type QueryCall = { sql: string; params: unknown[] };

function makeApp(opts: {
  token?: string;
  agents?: Array<{ id: string; company_id: string }>;
}) {
  const calls: QueryCall[] = [];
  const agents = opts.agents ?? [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM agents WHERE id=\$1/.test(sql)) {
      const id = params[0] as string;
      const hit = agents.find((a) => a.id === id);
      return hit ? { rows: [{ company_id: hit.company_id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM agents ORDER BY created_at/.test(sql)) {
      return agents.length > 0
        ? { rows: [{ id: agents[0]!.id, company_id: agents[0]!.company_id }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO heartbeat_runs/.test(sql)) {
      return { rows: [{ id: "adj-run-1" }], rowCount: 1 };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/budget",
    budgetResetRoutes({} as any, {
      query,
      readToken: () => opts.token,
    }),
  );
  return { app, query, calls };
}

const TOKEN = "hunter2";
const AGENT = "00000000-0000-0000-0000-0000000000a1";
const COMPANY = "00000000-0000-0000-0000-0000000000c1";

describe("POST /api/budget/reset", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when no token header", async () => {
    const { app, query } = makeApp({ token: TOKEN, agents: [{ id: AGENT, company_id: COMPANY }] });
    const res = await request(app)
      .post("/api/budget/reset")
      .send({ scope: "per_agent_daily", target_agent_id: AGENT, reason: "reset" });
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 403 when token mismatches", async () => {
    const { app, query } = makeApp({ token: TOKEN, agents: [{ id: AGENT, company_id: COMPANY }] });
    const res = await request(app)
      .post("/api/budget/reset")
      .set("X-Paperclip-Human-Token", "wrong-token-value-xx")
      .send({ scope: "per_agent_daily", target_agent_id: AGENT, reason: "reset" });
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 when body is missing fields", async () => {
    const { app } = makeApp({ token: TOKEN });
    const res = await request(app)
      .post("/api/budget/reset")
      .set("X-Paperclip-Human-Token", TOKEN)
      .send({ scope: "bogus_scope" });
    expect(res.status).toBe(400);
  });

  it("inserts negative-cost adjustment row for per_agent_daily", async () => {
    const { app, calls } = makeApp({
      token: TOKEN,
      agents: [{ id: AGENT, company_id: COMPANY }],
    });
    const res = await request(app)
      .post("/api/budget/reset")
      .set("X-Paperclip-Human-Token", TOKEN)
      .send({ scope: "per_agent_daily", target_agent_id: AGENT, reason: "refund" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      scope: "per_agent_daily",
      delta: -999,
      adjustment_run_id: "adj-run-1",
    });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO heartbeat_runs"));
    expect(insert).toBeDefined();
    expect(insert!.params[0]).toBe(COMPANY);
    expect(insert!.params[1]).toBe(AGENT);
    const usageJson = JSON.parse(insert!.params[2] as string);
    expect(usageJson).toMatchObject({
      adjustment: true,
      adjustment_scope: "per_agent_daily",
      reason: "refund",
      costUsd: -999,
    });
  });

  it("stamps issue_id into usage_json for per_issue_total scope", async () => {
    const { app, calls } = makeApp({
      token: TOKEN,
      agents: [{ id: AGENT, company_id: COMPANY }],
    });
    const res = await request(app)
      .post("/api/budget/reset")
      .set("X-Paperclip-Human-Token", TOKEN)
      .send({
        scope: "per_issue_total",
        target_id: "issue-42",
        reason: "retrying after fix",
      });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO heartbeat_runs"));
    const usageJson = JSON.parse(insert!.params[2] as string);
    expect(usageJson.issue_id).toBe("issue-42");
  });
});
