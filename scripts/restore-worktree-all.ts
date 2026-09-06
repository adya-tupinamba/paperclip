// Restore workspaceStrategy=git_worktree on all active ILM agents.
// Run: pnpm --filter @paperclipai/db exec tsx ../../scripts/restore-worktree-all.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const WS = {
  type: "git_worktree",
  worktreeParentDir: "C:\\Users\\ilm\\Documents\\GitHub\\ilm-worktrees",
};

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE agents
      SET adapter_config = jsonb_set(adapter_config, '{workspaceStrategy}', ${sql.json(WS)}::jsonb),
          updated_at = NOW()
      WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')
        AND status != 'paused'
        AND adapter_type IN ('codex_local', 'pi_local')
      RETURNING name, adapter_type, adapter_config->'workspaceStrategy' AS ws
    `;
    console.log("Restored workspaceStrategy on:");
    console.table(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
