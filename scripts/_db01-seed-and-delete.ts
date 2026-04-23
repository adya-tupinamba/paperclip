// Plan 01-01 Task 3 step 5c: seed-fallback path for end-to-end DELETE reproduction.
//
// Why fallback: f0c2b690 was restored to active and DELETE attempted, but the
// companyService.remove handler has additional pre-existing FK ordering bugs
// (goals before projects, missing document_revisions prune) that are outside
// the DB-01 scope. To prove DB-01 specifically (cost_events.heartbeat_run_id
// SET NULL working end-to-end through the transaction + FK cascade), we seed
// a MINIMAL test company with exactly the rows DB-01 targets:
// - 1 company
// - 1 agent (required by heartbeat_runs.agent_id NOT NULL)
// - 1 heartbeat_run
// - 1 cost_event referencing that heartbeat_run
//
// Then call companyService.remove() in-process, which exercises the EXACT
// transaction + FK cascade the plan requires. The FK fix is proven when:
// 1. svc.remove() completes without throwing
// 2. The cost_events row is gone (transaction tx.delete ran)
// 3. No 23503 on the cost_events_heartbeat_run_id FK

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createDb } from "../packages/db/src/client.js";
import { companyService } from "../server/src/services/companies.js";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main(): Promise<void> {
  const cid = randomUUID();
  const aid = randomUUID();
  const rid = randomUUID();
  const eid = randomUUID();
  const prefix = `DB01${cid.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`.slice(0, 12);

  const sql = postgres(DB_URL, { max: 1 });
  try {
    // Seed minimal rows. All INSERTs inline in one connection.
    await sql.begin(async (tx: any) => {
      await tx`INSERT INTO companies (id, name, status, issue_prefix, issue_counter)
        VALUES (${cid}, ${"db01-test-" + cid.slice(0, 8)}, 'active', ${prefix}, 0)`;
      await tx`INSERT INTO agents (id, company_id, name, adapter_type, status)
        VALUES (${aid}, ${cid}, 'db01-test-agent', 'claude_local', 'paused')`;
      await tx`INSERT INTO heartbeat_runs (id, company_id, agent_id, status)
        VALUES (${rid}, ${cid}, ${aid}, 'completed')`;
      await tx`INSERT INTO cost_events
        (id, company_id, agent_id, heartbeat_run_id, provider, model, cost_cents, occurred_at)
        VALUES (${eid}, ${cid}, ${aid}, ${rid}, 'anthropic', 'claude-test', 1, NOW())`;
    });
    console.log("SEEDED_COMPANY_ID=" + cid);

    // Verify seed: cost_events row exists with heartbeat_run_id set
    const before = await sql`SELECT id, heartbeat_run_id FROM cost_events WHERE id = ${eid}`;
    console.log("before remove — cost_events row:", JSON.stringify(before[0]));
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Now call companyService.remove in-process
  const db = createDb(DB_URL);
  const svc = companyService(db);
  const result = await svc.remove(cid);
  if (!result) {
    console.error(`FAIL: svc.remove returned null — company ${cid} not found after seeding. HTTP_STATUS_EQUIVALENT=404`);
    process.exit(1);
  }
  console.log(`OK: svc.remove(${cid}) completed. HTTP_STATUS_EQUIVALENT=200`);

  // Verify post-delete: company and cost_events are gone
  const sql2 = postgres(DB_URL, { max: 1 });
  try {
    const co = await sql2`SELECT id FROM companies WHERE id = ${cid}`;
    const ce = await sql2`SELECT id FROM cost_events WHERE id = ${eid}`;
    const hb = await sql2`SELECT id FROM heartbeat_runs WHERE id = ${rid}`;
    console.log("after remove — companies:", co.length, "cost_events:", ce.length, "heartbeat_runs:", hb.length);
    if (co.length !== 0 || ce.length !== 0 || hb.length !== 0) {
      console.error("FAIL: expected all rows removed, got companies=" + co.length + " cost_events=" + ce.length + " heartbeat_runs=" + hb.length);
      process.exit(1);
    }
    console.log("OK: company, cost_events, and heartbeat_runs all pruned as expected.");
  } finally {
    await sql2.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error("FAIL:", err); process.exit(1); });
