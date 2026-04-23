// scripts/backfill-issue-metadata.ts
//
// Idempotent one-time backfill for orphan issues (null project_id OR null identifier).
// Promoted from scripts/_fix-orphans.ts (ad-hoc 2026-04-23 script that assigned
// ILV2-17..ILV2-41 after the overnight orchestrator produced the 25-row orphan batch).
//
// Root cause is fixed by Plan 01-02 (orchestrator refactor to issueService.create).
// This script is the cleanup tool for any rows that predate 01-02 OR any rows
// that leaked past it before the fix shipped.
//
// Usage:
//   pnpm tsx scripts/backfill-issue-metadata.ts           # apply
//   pnpm tsx scripts/backfill-issue-metadata.ts --dry-run # preview only, no writes
//
// Env:
//   PAPERCLIP_DB_URL               (default: postgres://paperclip:paperclip@127.0.0.1:54329/paperclip)
//   BACKFILL_COMPANY_ID            (default: 68892580-9963-4506-a987-90be8d8ddb26 — ILM-v2)
//   BACKFILL_DEFAULT_PROJECT_NAME  (default: "ILM Platform") — resolved to UUID at runtime
//                                  to avoid baking a stale project id into this long-lived tool.
//
// Idempotency:
//   - project_id UPDATE is guarded by `WHERE project_id IS NULL` — 2nd run matches 0 rows.
//   - identifier assignment loop selects rows with `WHERE identifier IS NULL` — 2nd run selects 0 rows.
//   - The inner UPDATE also re-asserts `AND identifier IS NULL` (belt-and-braces) so a concurrent
//     writer between SELECT and UPDATE cannot cause a row's identifier to be overwritten.
//   - If interrupted mid-loop, companies.issue_counter may have a gap (counter bumped
//     but issue row not yet updated). This is a monotonic gap, not a correctness bug;
//     resume is safe because the guard prevents double-assignment.
//
// Reversibility:
//   - project_id fills are not trivially reversible (the original NULL is lost). Safe
//     because the default project exists and all orphans belong there by design.
//   - identifier assignments are not reversible (identifier is a unique, user-facing label).
//   - companies.issue_counter bumps are not reversible without a fresh seed.
//
// Supersedes: scripts/_fix-orphans.ts (kept until Phase 5 OPS-01 deletes it together with
// the other ad-hoc _*.ts scripts).
// Phase-5 postmortem runbook (scripts/postmortem-stuck-orchestrator.ts) will wrap this tool.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const COMPANY_ID = process.env.BACKFILL_COMPANY_ID ?? "68892580-9963-4506-a987-90be8d8ddb26"; // ILM-v2
const DEFAULT_PROJECT_NAME = process.env.BACKFILL_DEFAULT_PROJECT_NAME ?? "ILM Platform";
const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  const report: Record<string, unknown> = { dryRun: DRY_RUN, companyId: COMPANY_ID };
  try {
    // Phase A: sample orphans (diagnostic, always runs)
    const sample = await sql`
      SELECT id, title, status, lifecycle_state, project_id, identifier, issue_number, origin_kind, created_at
      FROM issues
      WHERE company_id = ${COMPANY_ID}
        AND (project_id IS NULL OR identifier IS NULL)
      ORDER BY created_at ASC
      LIMIT 10
    `;
    report.sampleOrphans = sample;
    console.log(`[backfill] sample orphans (up to 10):`, JSON.stringify(sample, null, 2));

    // Phase B: resolve default project UUID by name (not by baked-in UUID — avoids stale-UUID trap).
    const projRows = await sql`
      SELECT id FROM projects
      WHERE company_id = ${COMPANY_ID} AND name = ${DEFAULT_PROJECT_NAME}
      LIMIT 1
    `;
    if (projRows.length === 0) {
      throw new Error(
        `Default project "${DEFAULT_PROJECT_NAME}" not found for company ${COMPANY_ID}. ` +
          `Set BACKFILL_DEFAULT_PROJECT_NAME or re-seed the project. Aborting.`,
      );
    }
    const defaultProjectId = projRows[0].id;
    report.defaultProjectId = defaultProjectId;

    // Phase C: fill null project_id (idempotent via WHERE guard).
    const nullProjBefore = await sql`
      SELECT count(*)::int AS n FROM issues
      WHERE company_id = ${COMPANY_ID} AND project_id IS NULL
    `;
    report.nullProjectIdBefore = nullProjBefore[0].n;
    if (!DRY_RUN && nullProjBefore[0].n > 0) {
      await sql`
        UPDATE issues
        SET project_id = ${defaultProjectId}, updated_at = NOW()
        WHERE company_id = ${COMPANY_ID} AND project_id IS NULL
      `;
    }
    const nullProjAfter = await sql`
      SELECT count(*)::int AS n FROM issues
      WHERE company_id = ${COMPANY_ID} AND project_id IS NULL
    `;
    report.nullProjectIdAfter = nullProjAfter[0].n;
    console.log(
      `[backfill] project_id: before=${nullProjBefore[0].n} after=${nullProjAfter[0].n} (dry-run=${DRY_RUN})`,
    );

    // Phase D: assign identifier for rows where identifier IS NULL.
    const noIdent = await sql`
      SELECT id FROM issues
      WHERE company_id = ${COMPANY_ID} AND identifier IS NULL
      ORDER BY created_at ASC
    `;
    report.nullIdentifierBefore = noIdent.length;
    console.log(`[backfill] identifier: ${noIdent.length} row(s) to assign (dry-run=${DRY_RUN})`);

    const assigned: Array<{ id: string; identifier: string; issueNumber: number }> = [];
    if (!DRY_RUN) {
      for (const row of noIdent) {
        // Bump counter + return prefix in a single UPDATE ... RETURNING (atomic per statement,
        // monotonic across interrupts).
        const counterRow = await sql`
          UPDATE companies SET issue_counter = issue_counter + 1
          WHERE id = ${COMPANY_ID}
          RETURNING issue_counter, issue_prefix
        `;
        const { issue_counter: n, issue_prefix: prefix } = counterRow[0];
        const identifier = `${prefix}-${n}`;
        // Belt-and-braces: extra `AND identifier IS NULL` protects against a concurrent writer
        // between the SELECT above and this UPDATE.
        await sql`
          UPDATE issues
          SET identifier = ${identifier},
              issue_number = ${n},
              updated_at = NOW()
          WHERE id = ${row.id} AND identifier IS NULL
        `;
        assigned.push({ id: row.id, identifier, issueNumber: n });
      }
    }
    report.assigned = assigned;

    // Phase E: final state.
    const after = await sql`
      SELECT count(*)::int AS n FROM issues
      WHERE company_id = ${COMPANY_ID}
        AND (project_id IS NULL OR identifier IS NULL)
    `;
    report.remainingBroken = after[0].n;
    console.log(`[backfill] remaining broken rows: ${after[0].n}`);
    console.log(`[backfill] report:`, JSON.stringify(report, null, 2));
    if (DRY_RUN) {
      console.log(`[backfill] DRY RUN — no writes performed. Re-run without --dry-run to apply.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
