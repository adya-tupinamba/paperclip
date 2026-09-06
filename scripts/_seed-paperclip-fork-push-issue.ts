// One-off: create "Fork paperclipai/paperclip + push ilm-v2-reformulation" issue in v2 company.
// Usage: pnpm --filter @paperclipai/db exec tsx ../../scripts/_seed-paperclip-fork-push-issue.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(path.resolve(thisDir, "..", "packages", "db", "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;

const DB_URL = process.env.PAPERCLIP_DB_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

const COMPANY_ID = "68892580-9963-4506-a987-90be8d8ddb26"; // ILM-v2
const PROJECT_ID = "676a2b38-934d-432c-b418-0f5c1f228493"; // Paperclip Self
const CEO_ID = "c7f6b007-82c7-4c2d-81ec-92543a3dc3fb";
const BACKEND_DEV_ID = "1b3afa29-6c64-46a7-a1ed-c50e118c9784";

const TITLE = "Fork paperclipai/paperclip e push branch ilm-v2-reformulation";

const DESCRIPTION = `## Why this matters

Branch local \`ilm-v2-reformulation\` (20+ commits inclui patches Windows criticos e overnight orchestrator) esta apenas local. Unico remote configurado e o upstream \`github.com/paperclipai/paperclip.git\`, onde adya nao tem permissao de push. Precisamos de um fork pessoal para preservar o trabalho e permitir backup/review.

## Context

- Repo local: C:\\\\Users\\\\ilm\\\\Documents\\\\GitHub\\\\paperclip
- Branch: ilm-v2-reformulation (HEAD: 77b3fbda)
- Remote atual: origin = https://github.com/paperclipai/paperclip.git (read-only)
- Credencial: env GITHUB_PERSONAL_ACCESS_TOKEN ou gh auth status
- User GitHub: adya-tupinamba

## Acceptance criteria (falsifiable)

1. Fork adya-tupinamba/paperclip existe em github.com (verificavel via \`gh repo view adya-tupinamba/paperclip\`).
2. Remote \`fork\` adicionado localmente apontando para https://github.com/adya-tupinamba/paperclip.git (visivel em \`git remote -v\`).
3. \`git push -u fork ilm-v2-reformulation\` completa com sucesso.
4. \`gh api repos/adya-tupinamba/paperclip/branches/ilm-v2-reformulation\` retorna 200.
5. \`git log origin/main..ilm-v2-reformulation --oneline\` preserva todos os commits (nada perdido).
6. \`origin\` permanece apontando para paperclipai/paperclip (nao sobrescrever — apenas adicionar novo remote).

## Suggested approach

\`\`\`bash
cd C:/Users/ilm/Documents/GitHub/paperclip
gh repo fork paperclipai/paperclip --clone=false --remote=false
git remote add fork https://github.com/adya-tupinamba/paperclip.git
git push -u fork ilm-v2-reformulation
gh api repos/adya-tupinamba/paperclip/branches/ilm-v2-reformulation | jq .name
\`\`\`

## Risks / edge cases

- Fork pode ja existir (gh retorna 422). Handle: idempotente — se ja existir, so adiciona remote.
- Se GITHUB_PERSONAL_ACCESS_TOKEN nao tem scope \`repo\`, push falha 403. Fallback: usar SSH se chave estiver no GitHub.
- Branch grande — se push timeout, aumentar http.postBuffer ou usar --no-thin.

## Non-goals

- NAO abrir PR ainda — so push da branch.
- NAO pushar outras branches (main, overnight-*) — so ilm-v2-reformulation.
- NAO rebase/squash — preserva history.

## Handoff target

CTO (para revisar se push foi limpo e decidir se abre PR upstream depois).

## Timebox

30 min.`;

async function main(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1 });
  try {
    const result = await sql.begin(async (tx: any) => {
      const counterRow = await tx`
        UPDATE companies SET issue_counter = issue_counter + 1, updated_at = NOW()
        WHERE id = ${COMPANY_ID}
        RETURNING issue_counter, issue_prefix
      `;
      const { issue_counter: n, issue_prefix: prefix } = counterRow[0];
      const identifier = `${prefix}-${n}`;

      const inserted = await tx`
        INSERT INTO issues (
          company_id, project_id, title, description,
          status, priority, assignee_agent_id, created_by_agent_id,
          issue_number, identifier, origin_kind
        ) VALUES (
          ${COMPANY_ID}, ${PROJECT_ID}, ${TITLE}, ${DESCRIPTION},
          'todo', 'medium', ${BACKEND_DEV_ID}, ${CEO_ID},
          ${n}, ${identifier}, 'manual'
        )
        RETURNING id, identifier, title, status, priority
      `;
      return inserted[0];
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
