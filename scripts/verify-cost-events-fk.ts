// Verify live DB has ON DELETE SET NULL on cost_events.heartbeat_run_id FK.
// Part of DB-01 (phase 01, plan 01). Run with: pnpm tsx scripts/verify-cost-events-fk.ts
// Exits 0 on pass, 1 on fail. No destructive operations.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const FK_NAME = "cost_events_heartbeat_run_id_heartbeat_runs_id_fk";

export async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    // confdeltype: 'a' = NO ACTION (default), 'r' = RESTRICT, 'c' = CASCADE, 'n' = SET NULL, 'd' = SET DEFAULT
    const rows = await sql`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conname = ${FK_NAME}
    `;
    if (rows.length === 0) {
      console.error(`FAIL: FK "${FK_NAME}" not found in pg_constraint. Did migration 0066 apply?`);
      process.exit(1);
    }
    const { confdeltype } = rows[0];
    if (confdeltype !== "n") {
      console.error(`FAIL: FK "${FK_NAME}" has confdeltype='${confdeltype}', expected 'n' (SET NULL). Migration 0066 did not apply correctly.`);
      process.exit(1);
    }
    console.log(`OK: FK "${FK_NAME}" has ON DELETE SET NULL (confdeltype='n').`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
