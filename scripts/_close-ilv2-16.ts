// One-off: mark ILV2-16 as done with completion note.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/_close-ilv2-16.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const ISSUE_ID = "70d3e564-5110-46fd-9f97-6acf8e595a17";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE issues
      SET status = 'done',
          updated_at = NOW()
      WHERE id = ${ISSUE_ID}
      RETURNING identifier, status
    `;
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
