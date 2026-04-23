/**
 * ILM-v2 — Task 5.2
 *
 * `POST /api/agents/:id/pull-next`
 *   1. Ask the dispatcher for the highest-priority planned issue assigned
 *      to the agent.
 *   2. Transition it `planned → implementing` via applyTransition.
 *   3. Fire dispatcherHook which wakes the agent.
 *
 * Returns `{hasNext:false}` when the agent has no eligible work.
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { applyTransition } from "../services/lifecycle.js";
import {
  dispatcherHook,
  pullNextForAgent,
  type WakeFn,
} from "../services/dispatcher.js";
import { buildLifecycleDb, buildQueryDb } from "../services/ilm-v2-db-adapter.js";
import { heartbeatService } from "../services/index.js";

export type AgentsPullNextDeps = {
  applyTransition?: typeof applyTransition;
  dispatcherHook?: typeof dispatcherHook;
  pullNextForAgent?: typeof pullNextForAgent;
  wake?: WakeFn;
};

export function agentsPullNextRoutes(db: Db, deps: AgentsPullNextDeps = {}) {
  const router = Router();
  const lifecycleDb = deps.applyTransition ? null : buildLifecycleDb(db);
  const queryDb =
    deps.dispatcherHook && deps.pullNextForAgent ? null : buildQueryDb(db);
  const hb = deps.wake ? null : heartbeatService(db);

  const transitionFn = deps.applyTransition ?? applyTransition;
  const hookFn = deps.dispatcherHook ?? dispatcherHook;
  const pullFn = deps.pullNextForAgent ?? pullNextForAgent;

  const wakeFn: WakeFn =
    deps.wake ??
    (async ({ agentId, issueId }) => {
      if (!hb) return;
      const run = await hb.wakeup(agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: "ilm_v2_pull_next",
        payload: { issueId },
        requestedByActorType: "system",
        requestedByActorId: null,
        contextSnapshot: {
          issueId,
          wakeReason: "ilm_v2_pull_next",
          source: "ilm_v2_pull_next",
        },
      });
      if (run?.id) return { runId: run.id };
      return;
    });

  router.post("/:id/pull-next", async (req, res) => {
    const agentId = req.params.id as string;

    const qDb = queryDb ?? (undefined as any);
    const next = await pullFn(qDb, agentId);
    if (!next) {
      res.json({ hasNext: false });
      return;
    }

    const lDb = lifecycleDb ?? (undefined as any);
    const r = await transitionFn(lDb, {
      issueId: next.issueId,
      to: "implementing" as any,
      actorId: agentId,
      reason: "ilm_v2_pull_queue_claim",
    });
    if (!r.ok) {
      res.status(422).json({
        ok: false,
        hasNext: true,
        issueId: next.issueId,
        error: r.reason,
      });
      return;
    }

    let dispatch: Awaited<ReturnType<typeof dispatcherHook>> = { woken: false };
    try {
      dispatch = await hookFn(
        qDb,
        { issueId: next.issueId, toState: r.toState },
        { wake: wakeFn },
      );
    } catch (err) {
      dispatch = {
        woken: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    res.json({ hasNext: true, issueId: next.issueId, dispatch });
  });

  return router;
}
