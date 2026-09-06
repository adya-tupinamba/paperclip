// Runs scripts/seed-ilm-company.sql and scripts/seed-ilm-backlog.sql in sequence
// against the locally-running embedded-postgres (127.0.0.1:54329).
//
// Usage (run from the repo root):
//   pnpm --filter @paperclipai/db exec tsx ../../scripts/run-ilm-seeds.ts
//
// Why createRequire: this script lives at /scripts/ which has no node_modules.
// We anchor the `postgres` resolution on packages/db/package.json (that package
// declares `postgres` as a dep, so its node_modules has it installed).
//
// Revert:
//   DELETE FROM companies WHERE name = 'ILM';  -- cascades agents/goals/projects/issues via FK

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbPackageJson = path.resolve(thisDir, "..", "packages", "db", "package.json");
const dbRequire = createRequire(dbPackageJson);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL =
  process.env.PAPERCLIP_DB_URL ??
  "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, {
    max: 1,
    onnotice: (n: { message: string }) => console.log("[pg notice]", n.message),
  });
  try {
    const companySqlPath = path.join(thisDir, "seed-ilm-company.sql");
    const backlogSqlPath = path.join(thisDir, "seed-ilm-backlog.sql");

    console.log("-- Applying seed-ilm-company.sql --");
    await sql.unsafe(fs.readFileSync(companySqlPath, "utf8"));

    console.log("-- Applying seed-ilm-backlog.sql --");
    await sql.unsafe(fs.readFileSync(backlogSqlPath, "utf8"));

    const counts = (await sql`
      WITH c AS (SELECT id FROM companies WHERE name = 'ILM')
      SELECT
        (SELECT count(*)::int FROM agents   WHERE company_id = (SELECT id FROM c)) AS agents,
        (SELECT count(*)::int FROM goals    WHERE company_id = (SELECT id FROM c)) AS goals,
        (SELECT count(*)::int FROM projects WHERE company_id = (SELECT id FROM c)) AS projects,
        (SELECT count(*)::int FROM issues   WHERE company_id = (SELECT id FROM c)) AS issues,
        (SELECT count(*)::int FROM agents   WHERE company_id = (SELECT id FROM c) AND status = 'paused') AS paused
    `) as Array<{ agents: number; goals: number; projects: number; issues: number; paused: number }>;
    console.log("");
    console.log("-- Final counts (expected: agents=9, goals=1, projects=3, issues=15, paused=2) --");
    console.log(counts[0]);

    const rows = (await sql`
      SELECT
        name,
        adapter_type,
        status,
        adapter_config->>'model' AS model
      FROM agents
      WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')
      ORDER BY
        CASE name
          WHEN 'CEO' THEN 1
          WHEN 'CTO' THEN 2
          WHEN 'DataEngineer' THEN 3
          WHEN 'BackendEngineer' THEN 4
          WHEN 'FrontendEngineer' THEN 5
          WHEN 'DevOpsSRE' THEN 6
          WHEN 'SecurityAuditor' THEN 7
          WHEN 'BackendBurst' THEN 8
          WHEN 'FrontendBurst' THEN 9
          ELSE 99
        END
    `) as Array<{ name: string; adapter_type: string; status: string; model: string | null }>;
    console.log("");
    console.log("-- Agents matrix --");
    console.table(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
