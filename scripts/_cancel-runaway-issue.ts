// Cancel the runaway issue that's stuck in pr_open and being infinitely retried by orchestrator.
// Also: see if issues has a workflow_state or state column distinct from status.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const RUNAWAY_ISSUE_ID = "7a92c708-8310-4fb0-b961-8578884a0fa6";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'issues' AND column_name ~ 'state|phase|workflow'
      ORDER BY column_name
    `;
    console.log("state-ish columns on issues:", cols.map((c: any) => c.column_name));

    const before = await sql`
      SELECT id, identifier, status, current_state, workflow_state, phase
      FROM issues WHERE id = ${RUNAWAY_ISSUE_ID}
    `.catch(async () => {
      return await sql`SELECT * FROM issues WHERE id = ${RUNAWAY_ISSUE_ID}`;
    });
    console.log("BEFORE:", JSON.stringify(before, null, 2));

    const updated = await sql`
      UPDATE issues
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${RUNAWAY_ISSUE_ID}
      RETURNING id, identifier, status, updated_at
    `;
    console.log("AFTER status update:", JSON.stringify(updated, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
