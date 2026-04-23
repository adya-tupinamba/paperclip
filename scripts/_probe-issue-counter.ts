// Probe companies.issue_counter for the ILM-v2 company. One-shot read-only.
// Usage: pnpm tsx scripts/_probe-issue-counter.ts [label]
// Output: "<label>: <counter>" on stdout.
//
// This is a throwaway probe for Plan 01-03 Task 2 step 5 (counter-stability proof).
// Safe to delete once the plan is verified; will be swept with other _*.ts scripts in Phase 5 OPS-01.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const COMPANY_ID = "68892580-9963-4506-a987-90be8d8ddb26";
const label = process.argv[2] ?? "counter";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const r = await sql`SELECT issue_counter FROM companies WHERE id = ${COMPANY_ID}`;
    console.log(`${label}: ${r[0]?.issue_counter ?? "null"}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
