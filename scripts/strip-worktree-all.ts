// Remove workspaceStrategy=git_worktree from all 7 active ILM agents so they can wake without
// an issue-linked workspace. Burst workers (paused) are unaffected.
// Run: pnpm --filter @paperclipai/db exec tsx ../../scripts/strip-worktree-all.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE agents
      SET adapter_config = adapter_config - 'workspaceStrategy',
          updated_at = NOW()
      WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')
        AND status != 'paused'
        AND adapter_config ? 'workspaceStrategy'
      RETURNING name, adapter_type, adapter_config->'workspaceStrategy' AS ws
    `;
    console.log("Stripped workspaceStrategy from:");
    console.table(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
