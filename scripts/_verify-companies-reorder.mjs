// scripts/_verify-companies-reorder.mjs
//
// Helper for Plan 01-01 Task 2 verify step: asserts that in
// server/src/services/companies.ts the single `tx.delete(costEvents)`
// statement sits BEFORE `tx.delete(heartbeatRuns)` within the remove()
// transaction, and that exactly one `tx.delete(costEvents)` line remains.
//
// Exits 0 on pass, non-zero on fail. Portable across Git Bash / cmd.

import { readFileSync } from "node:fs";

const src = readFileSync("server/src/services/companies.ts", "utf8");
const lines = src.split("\n");
const costLine = lines.findIndex((l) => l.includes("tx.delete(costEvents)"));
const hbLine = lines.findIndex((l) => l.includes("tx.delete(heartbeatRuns)"));

if (costLine === -1 || hbLine === -1) {
  console.error(
    `FAIL: missing delete statement. costLine=${costLine} hbLine=${hbLine}`,
  );
  process.exit(1);
}
if (costLine >= hbLine) {
  console.error(
    `FAIL: costEvents delete must come BEFORE heartbeatRuns delete. costLine=${
      costLine + 1
    } hbLine=${hbLine + 1}`,
  );
  process.exit(2);
}
const dupCount = (src.match(/tx\.delete\(costEvents\)/g) || []).length;
if (dupCount !== 1) {
  console.error(
    `FAIL: expected exactly 1 tx.delete(costEvents), found ${dupCount}`,
  );
  process.exit(3);
}
console.log(
  `OK: costEvents at line ${costLine + 1}, heartbeatRuns at line ${
    hbLine + 1
  }, single delete confirmed.`,
);
