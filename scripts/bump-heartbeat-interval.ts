// Bump heartbeat intervalMs to 5min on active ILM agents to prevent 30s polling bleed.
// Run: pnpm --filter @paperclipai/db exec tsx ../../scripts/bump-heartbeat-interval.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const INTERVAL_MS = 300000; // 5 minutes

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const rows = await sql`
      UPDATE agents
      SET runtime_config = jsonb_set(
            jsonb_set(coalesce(runtime_config,'{}'::jsonb), '{heartbeat}', coalesce(runtime_config->'heartbeat','{}'::jsonb)),
            '{heartbeat,intervalMs}',
            ${INTERVAL_MS}::text::jsonb
          ),
          updated_at = NOW()
      WHERE company_id = (SELECT id FROM companies WHERE name='ILM')
        AND status != 'paused' OR status = 'paused'  -- include paused for when they resume
      RETURNING name, adapter_type, status, runtime_config->'heartbeat'->'intervalMs' AS interval_ms
    `;
    console.log("Set intervalMs on:");
    console.table(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
