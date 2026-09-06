import postgres from "postgres";
const s = postgres("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip", { max: 1 });
try {
  await s`UPDATE issues SET assignee_agent_id = '1b3afa29-6c64-46a7-a1ed-c50e118c9784' WHERE id = '86e7f94b-6ed2-4937-9108-6c987bb0c1f4'`;
  console.log("ok");
} finally {
  await s.end();
}
