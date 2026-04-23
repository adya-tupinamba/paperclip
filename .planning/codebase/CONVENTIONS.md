# Coding Conventions

**Analysis Date:** 2026-04-23

## TypeScript Configuration

**Base config:** `tsconfig.base.json` — inherited by every workspace package.

```json
{
  "target": "ES2023",
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "esModuleInterop": true,
  "strict": true,
  "skipLibCheck": true,
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true,
  "forceConsistentCasingInFileNames": true,
  "resolveJsonModule": true,
  "isolatedModules": true
}
```

**Strictness:** `strict: true` at the root — all packages inherit it. Override policy:
- Do not relax `strict`, `forceConsistentCasingInFileNames`, or `isolatedModules` in per-package `tsconfig.json`.
- `@typescript-eslint/no-explicit-any` warnings appear as inline `// eslint-disable-next-line` suppressions when ingesting untyped third-party values (e.g., `scripts/run-ilm-seeds.ts`, `server/src/services/ilm-v2-db-adapter.ts`).

**Project references:** Root `tsconfig.json` declares a project-references graph. Per-package `tsconfig.json` always has `rootDir: "src"`, `outDir: "dist"`, and `include: ["src"]` (see `server/tsconfig.json`, any `packages/adapters/*/tsconfig.json`).

**Test isolation:** Server explicitly excludes tests from production compilation: `"exclude": ["src/__tests__"]` in `server/tsconfig.json`. Adapter tests live next to source (`*.test.ts`) and vitest compiles them via `vitest/config`.

**Type imports:** Always use `import type` for type-only imports to satisfy `isolatedModules`. Examples:
- `server/src/routes/health.ts`: `import type { Db } from "@paperclipai/db";`
- `packages/adapters/codex-local/src/server/index.ts`: `import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";`

## Linting & Formatting

**Linter:** No `.eslintrc.*`, `eslint.config.*`, or `biome.json` present at the repo root. Linting is enforced via TypeScript strictness plus ad-hoc `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments (suggesting ESLint runs in CI or from IDE without a committed config — treat the suppressions as authoritative pattern).

**Formatter:** No `.prettierrc.*` at the repo root. Formatting is de-facto: two-space indent, double quotes, trailing commas in multi-line literals, semicolons required. Match the ambient style of neighboring files rather than inventing one.

**Token check:** `scripts/check-forbidden-tokens.mjs` is run via `pnpm check:tokens`. It scans for forbidden identifier tokens (operator usernames, secret prefixes) before commits and in CI. See `server/src/__tests__/forbidden-tokens.test.ts`.

## File & Module Naming

**Source files:** `kebab-case.ts` is the dominant convention.
- `server/src/services/budget-guard.ts`
- `server/src/services/ilm-v2-db-adapter.ts`
- `packages/shared/src/lifecycle-states.ts`
- `packages/adapters/codex-local/src/server/codex-args.ts`

**React components:** `PascalCase.tsx` for components; `kebab-case.ts` or `camelCase.ts` for non-component utilities.
- `ui/src/components/IssueChatThread.tsx`
- `ui/src/components/ActivityCharts.tsx`
- `ui/src/lib/issue-filters.ts`

**Directory names:** `kebab-case` everywhere (`adapter-utils`, `openclaw-gateway`, `plugin-sdk`, `mcp-server`).

**Test files:** `*.test.ts` / `*.test.tsx`.
- Server: co-located in `server/src/__tests__/<feature>.test.ts` (186 files).
- Packages: co-located next to source (`packages/shared/src/lifecycle-states.test.ts`, `packages/adapters/codex-local/src/server/parse.test.ts`).
- UI: co-located next to source (`ui/src/App.test.tsx`, `ui/src/components/IssueRow.test.tsx`).
- Server services sometimes co-locate too (`server/src/services/budget-guard.test.ts`, `server/src/services/dispatcher.test.ts`, `server/src/services/handoff.test.ts`, `server/src/services/lifecycle.test.ts`).

**Migrations:** Drizzle generator format `NNNN_<kebab_slug>.sql` under `packages/db/src/migrations/`. Slug comes from drizzle-kit's Marvel-villain name generator by default; ILM-v2 work uses a descriptive slug (`0065_ilm_v2_lifecycle.sql`). Numbering is strict and sequential; `packages/db/src/check-migration-numbering.ts` runs via `pnpm --filter @paperclipai/db check:migrations` before every generate/build/typecheck.

**Migrations (prose):** `--> statement-breakpoint` is the canonical separator between statements within a single migration file (see `packages/db/src/migrations/0064_issue_thread_interaction_idempotency.sql`). Splitting happens in `splitMigrationStatements()` at `packages/db/src/client.ts`.

## Path Aliases & Imports

**Workspace package names:** All internal packages use `@paperclipai/` prefix and are referenced via `workspace:*` in `package.json`.
- `@paperclipai/db`, `@paperclipai/shared`, `@paperclipai/adapter-utils`
- `@paperclipai/adapter-codex-local`, `@paperclipai/adapter-claude-local`, etc.

**Package subpath exports:** Adapters publish a four-target API via `exports` in `package.json` (see `packages/adapters/claude-local/package.json`):
```json
"exports": {
  ".": "./src/index.ts",
  "./server": "./src/server/index.ts",
  "./ui": "./src/ui/index.ts",
  "./cli": "./src/cli/index.ts"
}
```
Consumers import the right surface: `import { execute } from "@paperclipai/adapter-codex-local/server"` rather than deep-reaching into dist.

**Extensions in imports:** `NodeNext` module resolution means `.js` suffix on relative imports even for `.ts` source:
- `import { approvalService } from "../services/approvals.ts";` (test files sometimes use `.ts`)
- `import { parseClaudeStreamJson } from "./parse.js";` (production code uses `.js`)

Production code MUST use `.js` suffix (NodeNext requirement); test files MAY use `.ts` because Vitest resolves either way.

**UI alias:** `ui/vitest.config.ts` and build config define `@` → `./src` plus a `lexical` alias:
```ts
resolve: { alias: { "@": path.resolve(__dirname, "./src"), lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs") } }
```

## Adapter Interface Convention

Every adapter under `packages/adapters/<name>-local/` has the same shape:

```
packages/adapters/<name>-local/
├── package.json            # @paperclipai/adapter-<name>-local, exports . | ./server | ./ui | ./cli
├── tsconfig.json           # extends ../../../tsconfig.base.json
├── vitest.config.ts        # environment: "node"
└── src/
    ├── index.ts            # type, label, DEFAULT_<NAME>_MODEL, models[], agentConfigurationDoc
    ├── server/
    │   ├── index.ts        # re-exports execute, test, parse, session codec
    │   ├── execute.ts      # execute(ctx: AdapterExecutionContext) => AdapterExecutionResult
    │   ├── test.ts         # testEnvironment() health probe
    │   ├── parse.ts        # parseXxxJsonl / stream parsers (usually tested)
    │   ├── skills.ts       # listXxxSkills / syncXxxSkills
    │   └── models.ts       # model metadata
    ├── ui/
    │   └── index.ts        # UI adapter exports (transcript parser etc)
    └── cli/
        └── index.ts        # CLI entry (probe scripts, stream formatters)
```

**Root `index.ts` shape** (`packages/adapters/codex-local/src/index.ts`):
```ts
export const type = "codex_local";
export const label = "Codex (local)";
export const DEFAULT_CODEX_LOCAL_MODEL = "gpt-5.4";
export const models = [ { id: DEFAULT_CODEX_LOCAL_MODEL, label: "..." }, ... ];
export const agentConfigurationDoc = `# codex_local agent configuration ...`;
```

**Server `index.ts` shape** (barrel + session codec):
```ts
export { execute, ensureXxxSkillsInjected } from "./execute.js";
export { listXxxSkills, syncXxxSkills } from "./skills.js";
export { testEnvironment } from "./test.js";
export { parseXxxJsonl, ... } from "./parse.js";
export const sessionCodec: AdapterSessionCodec = { deserialize, serialize, getDisplayId };
```

**Adapter type identifiers:** underscored (`claude_local`, `codex_local`, `opencode_local`, `pi_local`, `openclaw_gateway`). Constants live in `packages/shared/src/constants.ts` (`AGENT_ADAPTER_TYPES`). Plan/spec docs may use hyphens informally — always defer to the underscored runtime constant.

## Error Handling

**HTTP errors:** Thin subclass of `Error` in `server/src/errors.ts`:
```ts
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) { ... }
}
export function badRequest(message, details?) { return new HttpError(400, ...); }
export function unauthorized(message = "Unauthorized") { ... }
export function forbidden / notFound / conflict / unprocessable
```

**Status code taxonomy** (enforced by `AGENTS.md` section 8): `400/401/403/404/409/422/500`. Use the named helper, not `throw new Error`, for anything a route is expected to throw.

**Central error handler:** `server/src/middleware/error-handler.ts` consumed by Express; tested via `server/src/__tests__/error-handler.test.ts`. It:
- Calls `res.status(err.status ?? 500).json({ error: err.message })`.
- Attaches the original `Error` to `res.err` for downstream logging middleware.
- Preserves an `__errorContext` object for structured logger middleware.

**Validation errors:** Zod schemas in `packages/shared/src/validators/*.ts`. Throw `badRequest()` with the Zod issue array in `details`. Don't leak stack traces.

## Logging

**Framework:** `pino` + `pino-http` + `pino-pretty`. Logger is imported from `server/src/middleware/logger.ts`.

```ts
import { logger } from "../middleware/logger.js";
logger.info({ agentId, companyId }, "agent started");
logger.error({ err }, "failed to dispatch");
```

**Redaction:** Secrets redaction is enforced via `server/src/log-redaction.ts` and `packages/adapter-utils/src/log-redaction.ts`. Tests: `server/src/__tests__/log-redaction.test.ts`, `server/src/__tests__/redaction.test.ts`. Never log raw env values, bearer tokens, or session IDs without passing through redaction.

**Timezone:** Pino output is coerced into the Paperclip default timezone — see `server/src/__tests__/logger-tz.test.ts` for expected behavior.

**Pattern:** Structured-first. Object goes first, message second. Never string-interpolate secrets into the message.

## ILM-v2 Specific Patterns

**DB adapter shim** (`server/src/services/ilm-v2-db-adapter.ts`): The new lifecycle/budget/dispatcher services were written against a minimal `{query(sql, params) => Promise<{rows, rowCount}>}` shape, but the repo uses `postgres` (postgres.js) through drizzle. The shim wraps `db.$client` (the underlying `postgres` client) into that shape using `sql.unsafe(text, params)` (parameterized raw SQL) and `sql.reserve()` (reserved connection for manual `BEGIN/COMMIT`).

**Lifecycle state machine** (`packages/shared/src/lifecycle-states.ts`): 11-state frozen `as const` tuple driving TypeScript literal union plus a `TRANSITIONS` table checked by `isValidTransition()`. This is mirrored in the DB by `CHECK` constraints (see `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql`). When adding a state, update both the tuple and the SQL check constraint.

**Migration trigger pattern:** `0065_ilm_v2_lifecycle.sql` enforces `merged` terminality via a `BEFORE UPDATE` trigger (`trg_issues_merged_terminal`). Triggers belong in the migration that introduces the invariant, not scattered across later migrations.

## Seed Script Pattern

Two-file pattern for ILM seeds lives under `scripts/`:

**SQL file** (`scripts/seed-ilm-*.sql`, `scripts/seed-ilm-v2.sql`): Pure SQL that runs inside `BEGIN; ... COMMIT;`. Applicable via `psql -f`. Uses `DO $$ ... $$` blocks for multi-step logic with local variables (uuids, paths).

**TS wrapper** (`scripts/run-ilm-*.ts`, `scripts/ilm-v2-seed.ts`, `scripts/run-ilm-seeds.ts`): Node script that reads the SQL file and executes it via `postgres.js`.

**createRequire trick** (used in `scripts/run-ilm-seeds.ts`, `scripts/run-ilm-project-workspaces.ts`):

```ts
import { createRequire } from "node:module";
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dbPackageJson = path.resolve(thisDir, "..", "packages", "db", "package.json");
const dbRequire = createRequire(dbPackageJson);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres = dbRequire("postgres") as (url: string, opts?: any) => any;
```

**Why:** `scripts/` has no `node_modules` of its own. `postgres` is only hoisted under `packages/db/node_modules/`. Anchoring `createRequire` on `packages/db/package.json` resolves from that workspace without needing `pnpm --filter` wrapping.

**Alternative** (`scripts/ilm-v2-seed.ts`, `scripts/ilm-v2-smoke.ts`): Import `postgres` directly and run via `pnpm --filter @paperclipai/db exec tsx ../../scripts/<name>.ts`. The `--filter` forces tsx to resolve from the db workspace where `postgres` is installed.

**BEGIN/COMMIT gotcha** (`scripts/ilm-v2-seed.ts`): `postgres.js` rejects literal `BEGIN;` / `COMMIT;` with `UNSAFE_TRANSACTION`. Strip them with regex and wrap the body in `sql.begin(async (tx) => { await tx.unsafe(body); })`.

**Default DB URL:** `postgres://paperclip:paperclip@127.0.0.1:54329/paperclip` (embedded-postgres dev port). Override with `PAPERCLIP_DB_URL` or `ILM_V2_DB_URL`.

## Schema Source of Truth

`packages/db/src/schema/*.ts` (drizzle ORM). Schema files are kebab-case (`issues.ts`, `agents.ts`, `heartbeat_runs.ts`). Tables exported from `packages/db/src/schema/index.ts`. Changes go through the workflow in `AGENTS.md` section 6:
1. Edit schema file.
2. Export from `schema/index.ts`.
3. `pnpm db:generate` (runs `check-migrations` → compiles `packages/db` → `drizzle-kit generate`).
4. `pnpm -r typecheck`.

## Comments

**JSDoc:** Used heavily for "why" explanations, especially at file-top where a non-obvious choice was made. Example: `server/src/services/ilm-v2-db-adapter.ts` opens with a 20-line JSDoc explaining the three rejected alternatives before the code.

**Inline rationale comments:** Common style for pointing out migration-plan vs. reality mismatches. Example from `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql`:
```sql
-- NOTE: plan referenced `assignee_id`, but the issues table uses `assignee_agent_id`
-- (see packages/db/src/schema/issues.ts). Using the real column for the lifecycle queue.
```

**Scripts header:** Every script under `scripts/` opens with a multi-line `//` comment block stating purpose, usage, and revert instructions. See `scripts/run-ilm-seeds.ts` opening for the canonical shape.

## Module Design

**Barrel files:** `packages/shared/src/index.ts` is an aggressive barrel (800+ exports). Every new export must be added here to be visible to consumers. Adapter `server/index.ts` files are smaller barrels targeted at their feature surface.

**Function style:** Exported factory functions use lowercase (`approvalService(db)`, `budgetService(db)`, `healthRoutes(db, opts)`). Classes are rare — `HttpError` is one of few.

**Service pattern:** `server/src/services/<name>.ts` exports a factory (usually named `<name>Service(db)`) that returns an object with methods. Tests mock `db` with a hand-rolled stub that matches the call signature (`select/from/where/returning` chain) — see `server/src/__tests__/approvals-service.test.ts` lines 40-56 for the stub shape.

**Route pattern:** `server/src/routes/<name>.ts` exports a factory (`<name>Routes(db, opts?)`) that returns an Express `Router()`. Tests mount the router on a fresh `express()` app and use `supertest`.

## Constants as Frozen Tuples

All enum-like sets are declared as `as const` tuples with a derived type:

```ts
// packages/shared/src/constants.ts
export const AGENT_ADAPTER_TYPES = [
  "process","http","claude_local","codex_local","gemini_local",
  "opencode_local","pi_local","cursor","openclaw_gateway",
] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number] | (string & {});
```

The `| (string & {})` widening is deliberate — it keeps autocomplete while allowing plugin-registered adapter types. Use the same pattern when adding a new enum.

## Naming — Runtime Values

- DB columns: `snake_case` (`assignee_agent_id`, `lifecycle_state`, `company_id`).
- TS fields: `camelCase` (`assigneeAgentId`, `lifecycleState`, `companyId`). Mapping lives in drizzle schema.
- Environment variables: `SCREAMING_SNAKE_CASE` with `PAPERCLIP_` prefix for runtime config (`PAPERCLIP_DB_URL`, `PAPERCLIP_FEATURE_ILM_V2`, `PAPERCLIP_DEV_SERVER_STATUS_TOKEN`), `ILM_V2_` prefix for ILM-v2 smoke script env.
- Feature flags: `PAPERCLIP_FEATURE_<NAME>` env var + `isFeature<Name>Enabled()` helper in `packages/shared/src/feature-flags.ts`.

## Node / pnpm

- Node: `>= 20` (`package.json` engines).
- Package manager: `pnpm@9.15.4` (pinned via `packageManager`).
- Monorepo: `pnpm-workspace.yaml` defines the workspace. Every filter runs through `pnpm --filter @paperclipai/<name>` or `pnpm -r` (recursive).
- Patches: `patches/embedded-postgres@18.1.0-beta.16.patch` applied via pnpm `patchedDependencies`.

---

*Convention analysis: 2026-04-23*
