import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Route-level smoke test: stubs `applyTransition` + `dispatcherHook` through
 * the deps hook the route exposes. No real DB — Claude Code's shell runs
 * elevated on Windows so the embedded-pg helper can't boot.
 */

import { issuesTransitionRoutes } from "../routes/issues-transition.js";

function makeApp(deps: Parameters<typeof issuesTransitionRoutes>[1]) {
  const app = express();
  app.use(express.json());
  // pass a dummy db; deps short-circuit the real adapter calls.
  app.use("/api/issues", issuesTransitionRoutes({} as any, deps));
  return app;
}

const ISSUE = "00000000-0000-0000-0000-0000000000b1";
const ACTOR = "00000000-0000-0000-0000-0000000000a1";

describe("POST /api/issues/:id/transition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when body fails validation", async () => {
    const applyTransition = vi.fn();
    const dispatcherHook = vi.fn();
    const app = makeApp({ applyTransition: applyTransition as any, dispatcherHook: dispatcherHook as any });
    const res = await request(app).post(`/api/issues/${ISSUE}/transition`).send({});
    expect(res.status).toBe(400);
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("returns 422 when transition is invalid", async () => {
    const applyTransition = vi.fn(async () => ({ ok: false, reason: "invalid transition inbox → merged" }));
    const dispatcherHook = vi.fn();
    const app = makeApp({ applyTransition: applyTransition as any, dispatcherHook: dispatcherHook as any });
    const res = await request(app)
      .post(`/api/issues/${ISSUE}/transition`)
      .send({ to: "merged", actor_id: ACTOR });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid transition/);
    expect(dispatcherHook).not.toHaveBeenCalled();
  });

  it("returns 404 when issue not found", async () => {
    const applyTransition = vi.fn(async () => ({ ok: false, reason: "issue not found" }));
    const dispatcherHook = vi.fn();
    const app = makeApp({ applyTransition: applyTransition as any, dispatcherHook: dispatcherHook as any });
    const res = await request(app)
      .post(`/api/issues/${ISSUE}/transition`)
      .send({ to: "spec_d", actor_id: ACTOR });
    expect(res.status).toBe(404);
  });

  it("returns 200 + dispatch result on success", async () => {
    const applyTransition = vi.fn(async () => ({ ok: true, fromState: "planned", toState: "implementing" }));
    const dispatcherHook = vi.fn(async () => ({ woken: true }));
    const wake = vi.fn(async () => ({ runId: "r1" }));
    const app = makeApp({
      applyTransition: applyTransition as any,
      dispatcherHook: dispatcherHook as any,
      wake,
    });
    const res = await request(app)
      .post(`/api/issues/${ISSUE}/transition`)
      .send({
        to: "implementing",
        actor_id: ACTOR,
        reason: "pull-queue claim",
        side_effects: { handoff_md: "irrelevant" },
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      from: "planned",
      to: "implementing",
      dispatch: { woken: true },
    });
    expect(applyTransition).toHaveBeenCalledOnce();
    expect(dispatcherHook).toHaveBeenCalledOnce();
  });

  it("swallows dispatcher errors and reports them in the dispatch field", async () => {
    const applyTransition = vi.fn(async () => ({ ok: true, fromState: "planned", toState: "implementing" }));
    const dispatcherHook = vi.fn(async () => {
      throw new Error("wake boom");
    });
    const app = makeApp({
      applyTransition: applyTransition as any,
      dispatcherHook: dispatcherHook as any,
      wake: vi.fn(),
    });
    const res = await request(app)
      .post(`/api/issues/${ISSUE}/transition`)
      .send({ to: "implementing", actor_id: ACTOR });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dispatch).toEqual({ woken: false, reason: "wake boom" });
  });
});
