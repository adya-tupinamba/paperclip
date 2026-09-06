import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;
const sql = postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip", { max: 1 });

async function main(): Promise<void> {
  try {
    const runs = (await sql`
      SELECT id, status, error, error_code,
             length(coalesce(stdout_excerpt, '')) AS stdout_len,
             length(coalesce(stderr_excerpt, '')) AS stderr_len,
             stderr_excerpt
        FROM heartbeat_runs
        WHERE id = '554f700a-573a-4bc9-a37b-ee0bb1ea9aa0'
    `) as Array<{ id: string; status: string; error: string; error_code: string; stdout_len: number; stderr_len: number; stderr_excerpt: string }>;
    const r = runs[0];
    console.log("status=", r.status);
    console.log("error=", r.error);
    console.log("error_code=", r.error_code);
    console.log("stdout_len=", r.stdout_len, "stderr_len=", r.stderr_len);
    if (r.stderr_excerpt) console.log("\n--- FULL STDERR ---\n" + r.stderr_excerpt);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
