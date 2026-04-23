import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { opsRoutes } from "../routes/ops.js";
import { CAPS } from "../services/budget-guard.js";

type QueryCall = { sql: string; params: unknown[] };

function makeApp(handler: (sql: string, params: unknown[]) => any) {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const out = handler(sql, params);
    return out ?? { rows: [], rowCount: 0 };
  });
  const app = express();
  app.use("/api/ops", opsRoutes({} as any, { query }));
  return { app, query, calls };
}

describe("GET /api/ops/snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns agents, pipeline, transitions and caps", async () => {
    const { app } = makeApp((sql) => {
      if (/FROM agents a/.test(sql)) {
        return {
          rows: [
            {
              id: "a1",
              name: "CTO",
              role: "cto",
              status: "idle",
              pause_reason: null,
              active_run_id: null,
              spend_today: "1.25",
            },
          ],
          rowCount: 1,
        };
      }
      if (/FROM issues\s+GROUP BY lifecycle_state/.test(sql)) {
        return {
          rows: [
            { lifecycle_state: "inbox", count: 3 },
            { lifecycle_state: "implementing", count: 1 },
          ],
          rowCount: 2,
        };
      }
      if (/FROM issue_transitions t/.test(sql)) {
        return {
          rows: [
            {
              id: "t1",
              issue_id: "i1",
              from_state: "planned",
              to_state: "implementing",
              actor_id: "a1",
              run_id: null,
              reason: null,
              created_at: "2026-04-22T00:00:00Z",
              title: "Fix bug",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app).get("/api/ops/snapshot");
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0]).toMatchObject({
      id: "a1",
      role: "cto",
      spend_today: 1.25,
    });
    expect(res.body.pipeline).toEqual([
      { lifecycle_state: "inbox", count: 3 },
      { lifecycle_state: "implementing", count: 1 },
    ]);
    expect(res.body.transitions[0]).toMatchObject({
      id: "t1",
      to_state: "implementing",
      title: "Fix bug",
    });
    expect(res.body.caps).toEqual(CAPS);
  });
});

describe("GET /api/ops/daily-report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns merged/spend/retries for today", async () => {
    const { app } = makeApp((sql) => {
      if (/to_state = 'merged'/.test(sql)) return { rows: [{ n: 4 }], rowCount: 1 };
      if (/FROM heartbeat_runs/.test(sql)) return { rows: [{ total: "12.50" }], rowCount: 1 };
      if (/SUM\(retry_count\)/.test(sql)) return { rows: [{ n: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app).get("/api/ops/daily-report");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      merged_today: 4,
      spend_today_usd: 12.5,
      total_retries: 7,
    });
    expect(typeof res.body.date).toBe("string");
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles empty tables with zeros", async () => {
    const { app } = makeApp(() => ({ rows: [], rowCount: 0 }));
    const res = await request(app).get("/api/ops/daily-report");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      merged_today: 0,
      spend_today_usd: 0,
      total_retries: 0,
    });
  });
});
