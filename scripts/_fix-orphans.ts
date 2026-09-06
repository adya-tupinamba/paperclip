// Fix orphan issues (projectId null or identifier null) in v2 company.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const COMPANY_ID = "68892580-9963-4506-a987-90be8d8ddb26";
const DEFAULT_PROJECT = "39f55e51-9245-4607-b4b8-0ec5d8eca96f";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const sample = await sql`
      SELECT id, title, status, lifecycle_state, project_id, identifier, issue_number, origin_kind
      FROM issues
      WHERE company_id = ${COMPANY_ID}
        AND (project_id IS NULL OR identifier IS NULL)
      LIMIT 5
    `;
    console.log("Sample orphans:", JSON.stringify(sample, null, 2));

    await sql`
      UPDATE issues
      SET project_id = ${DEFAULT_PROJECT}, updated_at = NOW()
      WHERE company_id = ${COMPANY_ID} AND project_id IS NULL
    `;

    const noIdent = await sql`
      SELECT id FROM issues
      WHERE company_id = ${COMPANY_ID} AND identifier IS NULL
      ORDER BY created_at
    `;
    console.log(`Issues missing identifier: ${noIdent.length}`);

    for (const row of noIdent) {
      const counterRow = await sql`
        UPDATE companies SET issue_counter = issue_counter + 1
        WHERE id = ${COMPANY_ID}
        RETURNING issue_counter, issue_prefix
      `;
      const { issue_counter: n, issue_prefix: prefix } = counterRow[0];
      await sql`
        UPDATE issues
        SET identifier = ${`${prefix}-${n}`},
            issue_number = ${n},
            updated_at = NOW()
        WHERE id = ${row.id}
      `;
    }

    const after = await sql`
      SELECT count(*)::int AS n FROM issues
      WHERE company_id = ${COMPANY_ID}
        AND (project_id IS NULL OR identifier IS NULL)
    `;
    console.log("Remaining broken:", JSON.stringify(after, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
