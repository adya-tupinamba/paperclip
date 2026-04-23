// scripts/_verify-orchestrator-create-path.ts
//
// DB-02 / ROADMAP SC-3 integration verifier (Plan 01-02 Task 3).
//
// Invokes the refactored createIssue path ONCE against the live embedded-postgres
// (no Claude call, no CEO spec step, no ILM-v1 HTTP fetch). Then SQL-asserts that
// the new issue row has non-null project_id + non-null identifier, and that
// companies.issue_counter incremented by exactly 1 across the call.
//
// This satisfies SC-3 ("verified by SQL assertion after a fresh orchestrator run")
// at the integration level without burning Opus budget. The full orchestrator loop
// is still owned by Phase 4 TEST-02 for end-to-end coverage.
//
// Usage:  pnpm tsx scripts/_verify-orchestrator-create-path.ts
// Exits 0 on pass, 1 on fail. Creates one test issue per run — cleanup is manual
// (the test issue has origin_fingerprint prefix "verify-p01-02-" so it's greppable).
// Manual cleanup SQL:
//   DELETE FROM issues WHERE origin_fingerprint LIKE 'verify-p01-02-%';
// (Do NOT auto-delete inside the verifier — deleting would mask a rollback bug.)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const ILM_V2_COMPANY = "68892580-9963-4506-a987-90be8d8ddb26";
const CEO_ID = "c7f6b007-82c7-4c2d-81ec-92543a3dc3fb";
const FP_PREFIX = "verify-p01-02-";

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    // Capture baseline counter
    const cBeforeRows = await sql`
      SELECT issue_counter FROM companies WHERE id = ${ILM_V2_COMPANY}
    `;
    const cBefore = cBeforeRows[0];
    if (!cBefore) throw new Error(`Company ${ILM_V2_COMPANY} not found`);
    const counterBefore = Number(cBefore.issue_counter);

    // Resolve default project by name (matches orchestrator behavior)
    const projRows = await sql`
      SELECT id FROM projects
      WHERE company_id = ${ILM_V2_COMPANY} AND name = 'ILM Platform'
      LIMIT 1
    `;
    const proj = projRows[0];
    if (!proj) throw new Error(`Default project "ILM Platform" not found for ${ILM_V2_COMPANY}`);
    const projectId = proj.id as string;

    // Import the exact same service the refactored orchestrator calls.
    // NOTE: relative import mirrors packages/db/orchestrate-e2e.ts's refactored import in Task 1.
    const { createDb } = await import("../packages/db/src/client.js");
    const { issueService } = await import("../server/src/services/issues.js");
    const db = createDb(DB_URL);
    const svc = issueService(db);

    // Build a synthetic `src`-shaped payload (skips the ILM-v1 HTTP fetch + Claude call).
    const fakeSrcId = randomUUID().slice(0, 12);
    const originFingerprint = `${FP_PREFIX}${fakeSrcId}-${randomUUID().slice(0, 8)}`;

    // Single call through the refactored create path — exact same shape as Task 1 step 3.
    const created = await svc.create(ILM_V2_COMPANY, {
      projectId,
      title: `[verify p01-02] ${fakeSrcId}`,
      description: "Integration verifier run — Plan 01-02 Task 3. No Claude invocation.",
      priority: "medium",
      status: "open",
      originKind: "manual",
      originFingerprint,
      assigneeAgentId: CEO_ID,
    });

    // SQL post-assertions (SC-3 wording: project_id + identifier non-null, counter incremented by 1)
    const rowResult = await sql`
      SELECT id, company_id, project_id, identifier, issue_number, origin_fingerprint
      FROM issues
      WHERE id = ${created.id}
    `;
    const row = rowResult[0];
    if (!row) throw new Error(`FAIL: SELECT by id returned no row for ${created.id}`);
    if (row.project_id === null) throw new Error(`FAIL: project_id IS NULL for new issue ${created.id}`);
    if (row.identifier === null) throw new Error(`FAIL: identifier IS NULL for new issue ${created.id}`);
    if (row.origin_fingerprint !== originFingerprint) {
      throw new Error(
        `FAIL: origin_fingerprint mismatch — expected ${originFingerprint}, got ${row.origin_fingerprint}`,
      );
    }

    // Assert exactly 1 new row and counter incremented by exactly 1
    const cAfterRows = await sql`
      SELECT issue_counter FROM companies WHERE id = ${ILM_V2_COMPANY}
    `;
    const cAfter = cAfterRows[0];
    const counterAfter = Number(cAfter.issue_counter);
    const delta = counterAfter - counterBefore;
    if (delta !== 1) {
      throw new Error(
        `FAIL: issue_counter delta expected 1, got ${delta} (before=${counterBefore} after=${counterAfter})`,
      );
    }

    // Assert exactly 1 row by this fingerprint (double-commit paranoia check)
    const dupRows = await sql`
      SELECT count(*)::int AS n FROM issues WHERE origin_fingerprint = ${originFingerprint}
    `;
    const dupCount = Number(dupRows[0].n);
    if (dupCount !== 1) {
      throw new Error(
        `FAIL: expected exactly 1 issue with origin_fingerprint=${originFingerprint}, got ${dupCount}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          createdIssueId: created.id,
          identifier: created.identifier,
          projectId: row.project_id,
          counterBefore,
          counterAfter,
          delta,
          originFingerprint,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
