// One-off: insert a project_workspace for the self-hosted Paperclip project in v2 company.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/_seed-paperclip-self-workspace.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

const COMPANY_ID = "68892580-9963-4506-a987-90be8d8ddb26";
const PROJECT_ID = "676a2b38-934d-432c-b418-0f5c1f228493";
const CWD = "C:\\Users\\ilm\\Documents\\GitHub\\paperclip";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      INSERT INTO project_workspaces (
        company_id, project_id, name, source_type, cwd, default_ref, visibility, is_primary
      ) VALUES (
        ${COMPANY_ID}, ${PROJECT_ID}, 'paperclip-local', 'local_path',
        ${CWD}, 'ilm-v2-reformulation', 'default', true
      )
      ON CONFLICT DO NOTHING
      RETURNING id, name, cwd, default_ref, is_primary
    `;
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
