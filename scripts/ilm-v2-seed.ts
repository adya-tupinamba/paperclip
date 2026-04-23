/**
 * ILM-v2 seed helper — Phase 8b companion to `scripts/seed-ilm-v2.sql`.
 *
 * The raw SQL file wraps its body in `BEGIN;` / `COMMIT;` so it can be
 * applied via `psql -f`. That form is incompatible with `postgres.js`,
 * which rejects literal `BEGIN` / `COMMIT` statements with
 * `UNSAFE_TRANSACTION` (you must use `sql.begin()` instead).
 *
 * This helper strips those markers and wraps the DO-block in a proper
 * `sql.begin()` transaction so the seed is runnable via `tsx`. It also
 * cleans up any partial ILM-v2 rows from an earlier failed attempt, and
 * prints the 4 UUIDs needed by `scripts/ilm-v2-smoke.ts`.
 *
 * RUN (from repo root):
 *   pnpm --filter @paperclipai/db exec tsx ../../scripts/ilm-v2-seed.ts
 *
 * Why the `--filter @paperclipai/db` prefix: `postgres` (postgres.js) is
 * only hoisted under `packages/db/node_modules/`, so tsx must resolve
 * from that workspace.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_URL =
  process.env.ILM_V2_DB_URL ??
  "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

const sql = postgres(DB_URL, {
  onnotice: (n) => console.log("[NOTICE]", n.message),
  max: 1,
});

function resolveSeedPath(): string {
  // When run via `pnpm --filter @paperclipai/db exec tsx ../../scripts/ilm-v2-seed.ts`,
  // cwd is packages/db but import.meta.url points at the script location.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "seed-ilm-v2.sql");
}

try {
  // 1) Clean up any partial ILM-v2 rows from prior failed attempts.
  const existing = await sql`SELECT id FROM companies WHERE name = 'ILM-v2'`;
  for (const row of existing) {
    console.log(`[cleanup] removing stale ILM-v2 company id=${row.id}`);
    await sql`DELETE FROM agents WHERE company_id = ${row.id}`;
    await sql`DELETE FROM issues WHERE company_id = ${row.id}`.catch(() => {});
    await sql`DELETE FROM companies WHERE id = ${row.id}`;
  }

  // 2) Load the SQL body and strip the outer BEGIN; / COMMIT; markers.
  const rawSql = fs.readFileSync(resolveSeedPath(), "utf8");
  const body = rawSql
    .replace(/^[\s\S]*?BEGIN;\s*/m, "")
    .replace(/\s*COMMIT;\s*$/m, "");

  // 3) Run the stripped body inside a single postgres.js transaction.
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
  });
  console.log("SEED_OK");

  // 4) Emit the 4 UUIDs in env-var form so they can be copy-pasted.
  const company = await sql`
    SELECT id FROM companies WHERE name = 'ILM-v2'
    ORDER BY created_at DESC LIMIT 1
  `;
  if (company.length === 0) {
    throw new Error("No ILM-v2 company row found after seed");
  }
  console.log(`ILM_V2_COMPANY_ID=${company[0].id}`);

  const agents = await sql`
    SELECT id, name, role FROM agents
    WHERE company_id = ${company[0].id}
    ORDER BY name
  `;
  for (const a of agents) {
    const key =
      a.role === "ceo"
        ? "CEO"
        : a.role === "cto"
          ? "CTO"
          : a.role === "engineer"
            ? "BACKEND"
            : a.role.toUpperCase().replace(/[^A-Z]/g, "_");
    console.log(`ILM_V2_${key}_ID=${a.id}  # role=${a.role} name=${a.name}`);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[seed] FAIL:", msg);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
} finally {
  await sql.end();
}
