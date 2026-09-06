// Flip dangerouslyBypassApprovalsAndSandbox=true on the 3 Codex IC agents so they
// can actually modify files in their worktrees. CTO (Pi) and SecurityAuditor (Pi) stay
// with approvals/sandbox enabled because they don't write code.
//
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/enable-codex-write.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const ROLES = ["BackendEngineer", "FrontendEngineer", "DevOpsSRE"];

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE agents
      SET adapter_config = jsonb_set(adapter_config, '{dangerouslyBypassApprovalsAndSandbox}', 'true'::jsonb),
          updated_at = NOW()
      WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')
        AND name = ANY(${ROLES})
        AND adapter_type = 'codex_local'
      RETURNING name, adapter_config->'dangerouslyBypassApprovalsAndSandbox' AS bypass
    `;
    console.log("Enabled write-mode on:");
    console.table(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
