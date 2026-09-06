// Restore workspaceStrategy=git_worktree on CTO after smoke test.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/restore-worktree-cto.ts

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
    // Use parameterized values so backslashes survive the journey through postgres-js.
    const ws = { type: "git_worktree", worktreeParentDir: "C:\\Users\\ilm\\Documents\\GitHub\\ilm-worktrees" };
    const rows = await sql`
      UPDATE agents
      SET adapter_config = jsonb_set(adapter_config, '{workspaceStrategy}', ${sql.json(ws)}::jsonb),
          updated_at = NOW()
      WHERE name = 'CTO'
        AND company_id = (SELECT id FROM companies WHERE name = 'ILM')
      RETURNING name, adapter_config->'workspaceStrategy' AS ws
    `;
    console.log("Restored:", JSON.stringify(rows, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
