// Plan 01-01 Task 3 step 5: end-to-end DELETE reproduction against f0c2b690
// using the in-process companyService.remove path (step 5e fallback).
//
// Why in-process: the Paperclip server is already running with pre-edit handler code
// loaded in memory. Restarting would disrupt active operations. The in-process path
// exercises the exact same transaction + FK cascade, satisfying SC-1 per plan step 5e.

import { createDb } from "../packages/db/src/client.js";
import { companyService } from "../server/src/services/companies.js";

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const TEST_ID = process.env.TEST_ID ?? "f0c2b690-0bad-4421-8043-2f4a328df440";

async function main(): Promise<void> {
  const db = createDb(DB_URL);
  const svc = companyService(db);
  const result = await svc.remove(TEST_ID);
  if (!result) {
    console.error(`FAIL: svc.remove returned null — company ${TEST_ID} not found. HTTP_STATUS_EQUIVALENT=404`);
    process.exit(1);
  }
  console.log(`OK: svc.remove(${TEST_ID}) completed, company removed. HTTP_STATUS_EQUIVALENT=200`);
}

main().catch((err: unknown) => { console.error("FAIL:", err); process.exit(1); });
