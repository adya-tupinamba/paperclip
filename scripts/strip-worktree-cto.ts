// Temporary: strips workspaceStrategy=git_worktree from CTO adapter_config so
// first smoke heartbeat (wake without issue assigned) can actually run.
//
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/strip-worktree-cto.ts

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
      WHERE name = 'CTO'
        AND company_id = (SELECT id FROM companies WHERE name = 'ILM')
      RETURNING name, adapter_config->'model' AS model, adapter_config->'workspaceStrategy' AS ws
    `;
    console.log("Updated:", JSON.stringify(rows, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
