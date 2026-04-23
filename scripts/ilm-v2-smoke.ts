/**
 * ILM-v2 E2E smoke test — Phase 9 Task 9.1 + 9.2 (combined).
 *
 * Drives one synthetic issue through the new lifecycle pipeline:
 *
 *   inbox   → spec_d      (actor: CEO, side_effects.spec_md)
 *   spec_d  → planned     (actor: CTO, side_effects.plan_md)
 *   planned → implementing (actor: BackendDev — triggers dispatcher)
 *
 * Required env:
 *   ILM_V2_COMPANY_ID  — UUID of the seeded ILM-v2 company
 *   ILM_V2_CEO_ID      — UUID of the CEO agent
 *   ILM_V2_CTO_ID      — UUID of the CTO agent
 *   ILM_V2_BACKEND_ID  — UUID of the BackendDev agent
 *
 * Optional env:
 *   PAPERCLIP_API_URL       — default http://localhost:3100
 *   ILM_V2_DB_URL           — default postgres://paperclip:paperclip@127.0.0.1:54329/paperclip
 *
 * Notes:
 *   - Uses the `postgres` client (postgres.js) because that is what the
 *     repo's production code uses; the plan's original snippet imported
 *     `pg.Pool` but the codebase doesn't pull pg directly.
 *   - Expects server to be running with `PAPERCLIP_FEATURE_ILM_V2=true`.
 *   - Dispatcher may return `woken: false` when no live Codex env is
 *     present (e.g., sandboxed CI). This is reported, not fatal.
 *   - Does NOT cover `implementing → review → pr_open → merged`. Those
 *     transitions require real agent output (handoff_md that passes
 *     validateHandoff, a real branch, and a real PR URL), which are
 *     outside the scope of a synthetic smoke.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const API = process.env.PAPERCLIP_API_URL ?? "http://localhost:3100";
const DB_URL =
  process.env.ILM_V2_DB_URL ??
  "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[smoke] missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

const COMPANY_ID = requireEnv("ILM_V2_COMPANY_ID");
const CEO_ID = requireEnv("ILM_V2_CEO_ID");
const CTO_ID = requireEnv("ILM_V2_CTO_ID");
const BACKEND_ID = requireEnv("ILM_V2_BACKEND_ID");

type TransitionResponse = {
  ok: boolean;
  from?: string;
  to?: string;
  dispatch?: { woken: boolean; blocked?: boolean; reason?: string };
  error?: unknown;
};

async function transition(
  issueId: string,
  to: string,
  actorId: string,
  sideEffects?: Record<string, unknown>,
): Promise<TransitionResponse> {
  const url = `${API}/api/issues/${issueId}/transition`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      actor_id: actorId,
      reason: "smoke",
      side_effects: sideEffects,
    }),
  });
  const body = (await res.json()) as TransitionResponse;
  console.log(`→ ${to} [HTTP ${res.status}]`, JSON.stringify(body, null, 2));
  return body;
}

async function main() {
  const sql = postgres(DB_URL);
  const issueId = randomUUID();

  try {
    console.log(`[smoke] company=${COMPANY_ID}`);
    console.log(`[smoke] synthetic issueId=${issueId}`);
    console.log(`[smoke] API=${API}`);

    // 1. Insert the synthetic issue directly (bypasses ordinary creation flow).
    //    `issues` requires: origin_kind/origin_fingerprint (NOT NULL), status (NOT NULL),
    //    `description` (not `body`), and priority is text ('critical'|'high'|'medium'|'low').
    await sql`
      INSERT INTO issues (
        id, company_id, title, description,
        lifecycle_state, priority, status,
        origin_kind, origin_fingerprint
      )
      VALUES (
        ${issueId}, ${COMPANY_ID},
        'SMOKE: print hello',
        'add hello.py that prints hi',
        'inbox', 'medium', 'open',
        'manual', ${'smoke-' + issueId}
      )
    `;
    console.log(`[smoke] inserted issue id=${issueId} state=inbox`);

    // 2. inbox → spec_d (CEO writes a spec).
    const r1 = await transition(issueId, "spec_d", CEO_ID, {
      spec_md:
        "# Spec\nAdd `hello.py` that prints `hi` when invoked.\n\n## Acceptance\n- file exists\n- `python hello.py` prints `hi`",
    });
    if (!r1.ok) throw new Error(`spec_d failed: ${JSON.stringify(r1)}`);

    // 3. spec_d → planned (CTO writes a plan).
    const r2 = await transition(issueId, "planned", CTO_ID, {
      plan_md:
        "# Plan\n1. create hello.py at repo root\n2. body: `print('hi')`\n3. manual test: run it",
    });
    if (!r2.ok) throw new Error(`planned failed: ${JSON.stringify(r2)}`);

    // 4. Assign to BackendDev. Required before `implementing` so the
    //    dispatcher has someone to wake.
    await sql`
      UPDATE issues SET assignee_agent_id = ${BACKEND_ID} WHERE id = ${issueId}
    `;
    console.log(`[smoke] assigned to BackendDev=${BACKEND_ID}`);

    // 5. planned → implementing (BackendDev takes the issue).
    //    This should trigger dispatcherHook → wake → heartbeat.wakeup.
    //    Under this smoke's synthetic environment the wake may return
    //    `woken: false` if there is no adapter session to bootstrap.
    const r3 = await transition(issueId, "implementing", BACKEND_ID);
    if (!r3.ok) throw new Error(`implementing failed: ${JSON.stringify(r3)}`);

    console.log("");
    console.log("[smoke] === summary ===");
    console.log(`  issueId           = ${issueId}`);
    console.log(`  dispatcher.woken  = ${r3.dispatch?.woken ?? "unknown"}`);
    if (r3.dispatch?.reason) {
      console.log(`  dispatcher.reason = ${r3.dispatch.reason}`);
    }
    console.log("");
    console.log(
      "[smoke] if woken=true: look for a new heartbeat_runs row for BackendDev.",
    );
    console.log(
      "[smoke] if woken=false: read the reason (typical in sandbox: 'no assignee'|'active run exists'|'repo mutex held').",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});
