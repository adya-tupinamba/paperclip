/**
 * ILM-v2 — Task 5.1
 *
 * `POST /api/issues/:id/transition`
 *   1. Validates the body (zod).
 *   2. Calls `applyTransition` to change lifecycle_state (writes side-effects
 *      + audit row) in a single transaction.
 *   3. On success, fires `dispatcherHook` which may wake the assignee when
 *      the new state is `implementing`.
 *
 * Mounted in `app.ts` at `/api/issues` behind `isFeatureIlmV2Enabled()`.
 */
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { applyTransition } from "../services/lifecycle.js";
import { dispatcherHook, type WakeFn } from "../services/dispatcher.js";
import { buildLifecycleDb, buildQueryDb } from "../services/ilm-v2-db-adapter.js";
import { heartbeatService } from "../services/index.js";

const TransitionBody = z.object({
  to: z.string(),
  actor_id: z.string().uuid(),
  run_id: z.string().uuid().optional(),
  reason: z.string().optional(),
  side_effects: z
    .object({
      spec_md: z.string().optional(),
      plan_md: z.string().optional(),
      handoff_md: z.string().optional(),
      branch: z.string().optional(),
      pr_url: z.string().url().optional(),
      blocker_reason: z.string().optional(),
    })
    .optional(),
});

export type IssuesTransitionDeps = {
  applyTransition?: typeof applyTransition;
  dispatcherHook?: typeof dispatcherHook;
  wake?: WakeFn;
};

export function issuesTransitionRoutes(db: Db, deps: IssuesTransitionDeps = {}) {
  const router = Router();
  const lifecycleDb = deps.applyTransition ? null : buildLifecycleDb(db);
  const queryDb = deps.dispatcherHook ? null : buildQueryDb(db);
  const hb = deps.wake ? null : heartbeatService(db);

  const transitionFn = deps.applyTransition ?? applyTransition;
  const hookFn = deps.dispatcherHook ?? dispatcherHook;

  const wakeFn: WakeFn =
    deps.wake ??
    (async ({ agentId, issueId }) => {
      if (!hb) return;
      const run = await hb.wakeup(agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: "ilm_v2_lifecycle_transition",
        payload: { issueId },
        requestedByActorType: "system",
        requestedByActorId: null,
        contextSnapshot: {
          issueId,
          wakeReason: "ilm_v2_lifecycle_transition",
          source: "ilm_v2_dispatcher",
        },
      });
      if (run?.id) return { runId: run.id };
      return;
    });

  router.post("/:id/transition", async (req, res) => {
    const parsed = TransitionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const issueId = req.params.id as string;
    const body = parsed.data;

    const lDb = lifecycleDb ?? (undefined as any);
    const r = await transitionFn(lDb, {
      issueId,
      to: body.to as any,
      actorId: body.actor_id,
      runId: body.run_id,
      reason: body.reason,
      sideEffects: body.side_effects,
    });
    if (!r.ok) {
      const status = /not found/i.test(r.reason) ? 404 : 422;
      res.status(status).json({ ok: false, error: r.reason });
      return;
    }

    const qDb = queryDb ?? (undefined as any);
    let dispatch: Awaited<ReturnType<typeof dispatcherHook>> = { woken: false };
    try {
      dispatch = await hookFn(qDb, { issueId, toState: r.toState }, { wake: wakeFn });
    } catch (err) {
      dispatch = {
        woken: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    res.json({
      ok: true,
      from: r.fromState,
      to: r.toState,
      dispatch,
    });
  });

  return router;
}
