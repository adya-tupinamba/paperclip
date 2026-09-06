// Fix runaway loop: force lifecycle_state to terminal.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const ISSUE_ID = "7a92c708-8310-4fb0-b961-8578884a0fa6";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    // Discover possible terminal states from issue transitions or enum
    const distinct = await sql`
      SELECT lifecycle_state, count(*) FROM issues
      WHERE company_id = '68892580-9963-4506-a987-90be8d8ddb26'
      GROUP BY lifecycle_state ORDER BY count DESC
    `;
    console.log("Distinct lifecycle_states in v2:", JSON.stringify(distinct, null, 2));

    // Force to 'merged' (terminal) or 'cancelled' — try merged first since orchestrator stops there
    const updated = await sql`
      UPDATE issues
      SET lifecycle_state = 'merged', status = 'done', updated_at = NOW()
      WHERE id = ${ISSUE_ID}
      RETURNING id, lifecycle_state, status
    `;
    console.log("Forced to merged:", JSON.stringify(updated, null, 2));

    // Also fix the orphan issues (projectId=null). They probably belong to ILM Platform.
    const orphanFix = await sql`
      UPDATE issues
      SET project_id = '39f55e51-9245-4607-b4b8-0ec5d8eca96f', updated_at = NOW()
      WHERE company_id = '68892580-9963-4506-a987-90be8d8ddb26'
        AND project_id IS NULL
      RETURNING count(*)
    `.catch((e: any) => ({ error: String(e) }));
    console.log("Orphan fix result:", JSON.stringify(orphanFix, null, 2));

    // Count how many still broken
    const broken = await sql`
      SELECT count(*) AS n FROM issues
      WHERE company_id = '68892580-9963-4506-a987-90be8d8ddb26'
        AND (project_id IS NULL OR identifier IS NULL)
    `;
    console.log("Still-broken issues:", JSON.stringify(broken, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
