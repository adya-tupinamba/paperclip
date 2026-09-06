// Applies scripts/seed-ilm-project-workspaces.sql against local embedded-postgres.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/run-ilm-project-workspaces.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, {
    max: 1,
    onnotice: (n: { message: string }) => console.log("[pg notice]", n.message),
  });
  try {
    const sqlFile = path.join(thisDir, "seed-ilm-project-workspaces.sql");
    console.log("-- Applying seed-ilm-project-workspaces.sql --");
    const result = await sql.unsafe(fs.readFileSync(sqlFile, "utf8"));
    if (Array.isArray(result) && result.length > 0) {
      console.log("-- project_workspaces snapshot --");
      console.table(result);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
