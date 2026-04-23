import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { agentsPullNextRoutes } from "../routes/agents-pull-next.js";

function makeApp(deps: Parameters<typeof agentsPullNextRoutes>[1]) {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentsPullNextRoutes({} as any, deps));
  return app;
}

const AGENT = "00000000-0000-0000-0000-0000000000a1";
const ISSUE = "00000000-0000-0000-0000-0000000000b1";

describe("POST /api/agents/:id/pull-next", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 {hasNext:false} when no eligible work", async () => {
    const pullNextForAgent = vi.fn(async () => null);
    const applyTransition = vi.fn();
    const dispatcherHook = vi.fn();
    const app = makeApp({
      pullNextForAgent: pullNextForAgent as any,
      applyTransition: applyTransition as any,
      dispatcherHook: dispatcherHook as any,
    });
    const res = await request(app).post(`/api/agents/${AGENT}/pull-next`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasNext: false });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(dispatcherHook).not.toHaveBeenCalled();
  });

  it("claims work and returns dispatch result on success", async () => {
    const pullNextForAgent = vi.fn(async () => ({ issueId: ISSUE }));
    const applyTransition = vi.fn(async () => ({
      ok: true,
      fromState: "planned",
      toState: "implementing",
    }));
    const dispatcherHook = vi.fn(async () => ({ woken: true }));
    const wake = vi.fn(async () => ({ runId: "r1" }));
    const app = makeApp({
      pullNextForAgent: pullNextForAgent as any,
      applyTransition: applyTransition as any,
      dispatcherHook: dispatcherHook as any,
      wake,
    });
    const res = await request(app).post(`/api/agents/${AGENT}/pull-next`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hasNext: true,
      issueId: ISSUE,
      dispatch: { woken: true },
    });
    expect(applyTransition).toHaveBeenCalledOnce();
    const callArgs = applyTransition.mock.calls[0]!;
    expect(callArgs[1]).toMatchObject({
      issueId: ISSUE,
      to: "implementing",
      actorId: AGENT,
    });
  });

  it("returns 422 when transition is invalid", async () => {
    const pullNextForAgent = vi.fn(async () => ({ issueId: ISSUE }));
    const applyTransition = vi.fn(async () => ({ ok: false, reason: "handoff_md required leaving implementing" }));
    const dispatcherHook = vi.fn();
    const app = makeApp({
      pullNextForAgent: pullNextForAgent as any,
      applyTransition: applyTransition as any,
      dispatcherHook: dispatcherHook as any,
    });
    const res = await request(app).post(`/api/agents/${AGENT}/pull-next`).send({});
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      hasNext: true,
      issueId: ISSUE,
      error: expect.stringMatching(/handoff_md/),
    });
    expect(dispatcherHook).not.toHaveBeenCalled();
  });
});
