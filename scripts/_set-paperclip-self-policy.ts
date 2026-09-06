// One-off: set execution_workspace_policy + lead_agent_id + status on Paperclip Self project.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/_set-paperclip-self-policy.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const PROJECT_ID = "676a2b38-934d-432c-b418-0f5c1f228493";
const CEO_ID = "c7f6b007-82c7-4c2d-81ec-92543a3dc3fb";

const POLICY = {
  enabled: true,
  defaultMode: "isolated_workspace",
  allowIssueOverride: true,
  workspaceStrategy: {
    type: "git_worktree",
    baseRef: "ilm-v2-reformulation",
    branchTemplate: "paperclip-self/{{issue.identifier}}-{{slug}}",
    worktreeParentDir: "C:\\Users\\ilm\\Documents\\GitHub\\paperclip-self-worktrees",
  },
};

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE projects
      SET execution_workspace_policy = ${sql.json(POLICY)},
          lead_agent_id = ${CEO_ID},
          status = 'active',
          updated_at = NOW()
      WHERE id = ${PROJECT_ID}
      RETURNING id, name, status, lead_agent_id, execution_workspace_policy
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
