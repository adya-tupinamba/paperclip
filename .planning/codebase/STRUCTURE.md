# Codebase Structure

**Analysis Date:** 2026-04-23

## Directory Layout

```
paperclip/
├── packages/                          # All shared npm packages (pnpm workspace)
│   ├── db/                            # PostgreSQL schema, migrations, client
│   │   ├── src/
│   │   │   ├── schema/                # Drizzle table definitions (one file per table)
│   │   │   ├── migrations/            # Numbered *.sql + meta/_journal.json
│   │   │   ├── client.ts              # createDb() + migration inspect/apply/reconcile
│   │   │   ├── index.ts               # Package entry (re-exports schema + helpers)
│   │   │   ├── migrate.ts             # Standalone migration runner
│   │   │   ├── backup.ts              # pg_dump-based backup helper
│   │   │   └── seed.ts                # Seed data for tests
│   │   └── drizzle.config.ts
│   ├── shared/                        # Runtime-agnostic types, validators, constants
│   │   └── src/
│   │       ├── types/                 # Domain types (issue, agent, project, cost, ...)
│   │       ├── validators/            # zod schemas per resource
│   │       ├── telemetry/             # Telemetry client (client/config/events/state)
│   │       ├── lifecycle-states.ts    # The 11-state issue machine + transitions
│   │       ├── feature-flags.ts       # isFeatureIlmV2Enabled()
│   │       ├── pricing.ts             # Per-model rates
│   │       ├── api.ts                 # REST request/response types
│   │       ├── adapter-type.ts
│   │       ├── workspace-commands.ts
│   │       ├── issue-thread-interactions.ts
│   │       └── config-schema.ts
│   ├── adapter-utils/                 # ServerAdapterModule contract + helpers
│   │   └── src/
│   │       ├── types.ts               # Canonical AdapterExecutionContext/Result, ServerAdapterModule
│   │       ├── server-utils.ts        # runChildProcess, env/prompt helpers, skill readers
│   │       ├── billing.ts             # Usage → cost aggregation
│   │       ├── session-compaction.ts  # Session policy helpers
│   │       └── log-redaction.ts       # Secret-scrubbing for adapter logs
│   ├── adapters/                      # One package per agent backend
│   │   ├── claude-local/              # Claude Code CLI (primary)
│   │   ├── codex-local/               # OpenAI Codex CLI
│   │   ├── cursor-local/              # Cursor agent
│   │   ├── gemini-local/              # Google Gemini CLI
│   │   ├── opencode-local/            # opencode.ai CLI
│   │   ├── pi-local/                  # Pi coding agent
│   │   └── openclaw-gateway/          # Remote gateway adapter (HTTP)
│   ├── mcp-server/                    # MCP server for exposing paperclip to Claude/other MCP clients
│   └── plugins/
│       ├── sdk/                       # @paperclipai/plugin-sdk — host client + types
│       ├── create-paperclip-plugin/   # npm init template
│       └── examples/                  # Reference plugins
├── server/                            # Express + WebSocket API server
│   ├── src/
│   │   ├── index.ts                   # Entry: startServer(), embedded postgres, scheduler loops
│   │   ├── app.ts                     # createApp(db, opts) — composes middleware + mounts routes
│   │   ├── config.ts                  # Config loader (env + config file)
│   │   ├── config-file.ts
│   │   ├── errors.ts                  # HttpError subclasses (conflict, notFound, badRequest)
│   │   ├── paths.ts                   # PAPERCLIP_HOME path resolution
│   │   ├── home-paths.ts              # Well-known subpaths under PAPERCLIP_HOME
│   │   ├── worktree-config.ts         # Runtime port persistence for worktrees
│   │   ├── routes/                    # Express routers, one per resource
│   │   ├── services/                  # Domain services (factory fns taking Db)
│   │   ├── adapters/                  # Adapter registry + generic process/http adapters
│   │   │   ├── registry.ts            # adaptersByType + pause/override logic
│   │   │   ├── plugin-loader.ts       # Dynamic import of external adapter packages
│   │   │   ├── builtin-adapter-types.ts
│   │   │   ├── process/               # Generic "shell command" adapter
│   │   │   └── http/                  # Generic "HTTP webhook" adapter
│   │   ├── auth/                      # BetterAuth integration
│   │   ├── middleware/                # actor, board-mutation-guard, logger, validate, etc.
│   │   ├── realtime/                  # WebSocket live events
│   │   ├── storage/                   # Pluggable local-disk / S3 asset storage
│   │   ├── secrets/                   # Pluggable secret providers
│   │   ├── lib/                       # Generic helpers (join-request-dedupe, ...)
│   │   ├── types/                     # Ambient TS declarations
│   │   ├── agent-auth-jwt.ts          # Short-lived JWT for local adapters
│   │   ├── board-claim.ts             # Local-board → real-user ownership claim
│   │   ├── onboarding-assets/         # Bundled SVGs/PNGs served during onboarding
│   │   └── telemetry.ts
│   └── scripts/                       # Server-only maintenance scripts
├── ui/                                # React SPA
│   ├── src/
│   │   ├── main.tsx                   # Entry: mounts providers, registers service worker
│   │   ├── App.tsx                    # Router
│   │   ├── pages/                     # One file per route (Issues, Agents, Goals, ...)
│   │   ├── components/                # Shared components (Layout, Sidebar, editors, ...)
│   │   │   ├── ui/                    # Shadcn primitives
│   │   │   ├── access/                # Access-control specific components
│   │   │   └── transcript/            # Run transcript renderer
│   │   ├── api/                       # Typed fetch client, one module per resource
│   │   ├── context/                   # React Context providers (11 total)
│   │   ├── hooks/                     # Custom hooks
│   │   ├── lib/                       # Pure utilities (issue-tree, markdown, filters, ...)
│   │   ├── adapters/                  # UI per adapter (parse-stdout, config form, icon)
│   │   ├── plugins/                   # Plugin bridge + slots + launchers
│   │   └── fixtures/                  # Test fixtures
│   ├── public/
│   ├── storybook/
│   ├── index.html
│   ├── vite.config.ts
│   └── components.json                # shadcn config
├── cli/                               # paperclipai binary (commander.js)
│   └── src/
│       ├── index.ts                   # Program entry + command registration
│       ├── commands/                  # One module per subcommand
│       │   ├── onboard.ts
│       │   ├── doctor.ts
│       │   ├── run.ts
│       │   ├── worktree.ts
│       │   ├── heartbeat-run.ts
│       │   ├── configure.ts
│       │   ├── routines.ts
│       │   ├── db-backup.ts
│       │   ├── auth-bootstrap-ceo.ts
│       │   └── client/                # API-backed verbs (issue, company, agent, ...)
│       ├── adapters/                  # CLI-side adapter registry (stdout formatting)
│       ├── checks/                    # Doctor checks
│       ├── client/                    # HTTP client + board auth
│       ├── config/                    # Config file + data-dir + env schema
│       ├── prompts/                   # Interactive prompt helpers
│       └── utils/
├── scripts/                           # Repo-level TS/MJS/SH scripts
│   ├── dev-runner.ts                  # Watch-mode dev orchestrator
│   ├── dev-service.ts                 # dev list/stop
│   ├── provision-worktree.sh          # Bootstraps a multi-board worktree
│   ├── build-npm.sh                   # Release: bundles server+ui into npm
│   ├── release.sh / release-lib.sh
│   ├── create-github-release.sh
│   ├── check-forbidden-tokens.mjs
│   ├── backfill-issue-reference-mentions.ts
│   ├── migrate-inline-env-secrets.ts
│   ├── seed-ilm-*.sql / ilm-v2-seed.ts  # ILM (the user's company) seed data
│   ├── seed-ilm-v2.sql / seed-ilm-v2.md / ilm-v2-smoke.ts / ilm-v2-smoke.md
│   └── smoke/                         # End-to-end smoke test shell scripts
├── docs/                              # Mintlify documentation site
│   ├── adapters/, agents-runtime.md, api/, cli/, companies/, deploy/
│   ├── guides/, plans/, specs/, start/, superpowers/, codebase/
│   └── docs.json                      # Mintlify config
├── doc/                               # Internal design docs (non-published)
│   ├── SPEC.md, PRODUCT.md, DATABASE.md, CLI.md
│   ├── execution-semantics.md, memory-landscape.md
│   ├── DEPLOYMENT-MODES.md, DOCKER.md, DEVELOPING.md
│   ├── plans/, spec/, experimental/, plugins/
│   └── TASKS.md, TASKS-mcp.md
├── tests/                             # E2E Playwright tests
│   └── e2e/, release-smoke/
├── evals/                             # Promptfoo eval configs
├── patches/                           # pnpm patch-package overrides (embedded-postgres)
├── docker/                            # Docker assets
├── .agents/                           # Agent-facing skills/tools bundles
├── .claude/                           # Claude Code skills bundle
├── skills/                            # Global skills
├── releases/                          # Release notes
├── report/                            # Generated reports
├── .planning/codebase/                # GSD codebase maps (this folder)
├── AGENTS.md                          # Instructions bundle for agents
├── README.md, ROADMAP.md, CONTRIBUTING.md, SECURITY.md
├── Dockerfile, package.json, pnpm-workspace.yaml
├── tsconfig.base.json, tsconfig.json, vitest.config.ts
└── .env, .env.example, .gitignore, .npmrc
```

**External (not in repo):**
- `~/.paperclip/drafts/ILM-v1/` and `~/.paperclip/drafts/ILM-v2/` — user's in-progress plans for the ILM company. Each contains per-agent folders (`CEO`, `CTO`, `BackendDev`, `FrontendDev`, `DataEng`, `SecurityAuditor`, etc.), a `README.md`, and a `NEXT-STEPS.md`. `ILM-v2` also has `BRING-ONLINE-PROMPT.md`.
- `~/.paperclip/data/` — embedded-postgres data directory when `DATABASE_URL` is not set.
- `~/.paperclip/plugins/` — installed plugins loaded by `server/src/services/plugin-loader.ts::DEFAULT_LOCAL_PLUGIN_DIR`.

## Directory Purposes

**`packages/db/`:**
- Purpose: the single source of truth for schema. No business logic here.
- Contains: one table schema per file under `schema/`, one `*.sql` per migration under `migrations/`, plus `client.ts` with migration introspection and reconciliation.
- Key files: `packages/db/src/schema/index.ts` (barrel), `packages/db/src/client.ts` (createDb, inspectMigrations, applyPendingMigrations, reconcilePendingMigrationHistory), `packages/db/src/migrations/meta/_journal.json`.

**`packages/shared/`:**
- Purpose: types, validators, state machines, and constants that must be identical across server, UI, CLI, and adapters. Zero runtime side effects.
- Key files: `packages/shared/src/lifecycle-states.ts`, `packages/shared/src/api.ts`, `packages/shared/src/feature-flags.ts`, `packages/shared/src/pricing.ts`, `packages/shared/src/types/index.ts`, `packages/shared/src/validators/index.ts`.

**`packages/adapter-utils/`:**
- Purpose: the adapter contract plus the helpers adapters share (child-process runner, env builder, billing aggregation, session compaction, log redaction).
- Key files: `packages/adapter-utils/src/types.ts` (`ServerAdapterModule`, `AdapterExecutionContext`), `packages/adapter-utils/src/server-utils.ts` (`runChildProcess`, `buildPaperclipEnv`, `readPaperclipRuntimeSkillEntries`).

**`packages/adapters/<type>/`:**
- Purpose: one package per agent backend. Exports `type`, `label`, `models`, `agentConfigurationDoc` at root and separate `server/`, `ui/`, `cli/` entry points.
- Layout: `packages/adapters/<type>/src/{index.ts,server/{execute,parse,skills,test,models,index}.ts,ui/{parse-stdout,build-config,index}.ts,cli/{format-event,quota-probe,index}.ts}`.
- Required server exports: `execute`, `testEnvironment`, `sessionCodec`, `listSkills`, `syncSkills`, `models` (or `listModels`).

**`server/src/routes/`:**
- Purpose: HTTP endpoint handlers. Each file mounts one resource.
- Pattern: `export function <name>Routes(db): Router`. Validation uses zod schemas from `@paperclipai/shared/validators`. Services are instantiated via factory functions from `services/`.

**`server/src/services/`:**
- Purpose: domain logic. Factory functions taking a Drizzle `Db`.
- Test co-location: `*.test.ts` files live next to the service (e.g. `dispatcher.test.ts`, `watchdog.test.ts`, `lifecycle.test.ts`, `handoff.test.ts`, `budget-guard.test.ts`).

**`server/src/adapters/`:**
- Purpose: registry that imports `.../server` entry of each `packages/adapters/*` and exposes `getServerAdapter(type)`.
- Extensibility: `plugin-loader.ts` discovers external adapter packages (e.g. `hermes-paperclip-adapter`, `droid_local`) at startup.

**`ui/src/pages/`:**
- Purpose: top-level route components. One file ≈ one URL path.
- Naming: PascalCase, typically matching the resource name plural/singular (`Issues.tsx`, `IssueDetail.tsx`, `Agents.tsx`, `AgentDetail.tsx`).

**`ui/src/components/`:**
- Purpose: reusable React components.
- Convention: PascalCase filename, default export unless utility. Shadcn primitives live under `ui/src/components/ui/`.

**`ui/src/api/`:**
- Purpose: typed fetch wrappers. One module per server resource. `index.ts` barrel-exports. `client.ts` has the fetch helper.

**`ui/src/adapters/<type>/`:**
- Purpose: adapter-specific UI (transcript parser, config form pieces, icon). Registered via `ui/src/adapters/registry.ts`.

**`cli/src/commands/`:**
- Purpose: one module per commander subcommand. `client/` subfolder contains verbs that talk to the REST API.

**`scripts/`:**
- Purpose: repo-level TS/MJS/SH utilities — dev runner, builders, release scripts, seeders, smoke tests, one-off data fixes.
- Naming: leading `_` (underscore) marks ad-hoc/one-shot scripts the operator ran to fix incidents (e.g. `_fix-runaway.ts`, `_cancel-runaway-issue.ts`, `_fix-orphans.ts`).
- ILM-specific seeders live here: `seed-ilm-company.sql`, `seed-ilm-backlog.sql`, `seed-ilm-project-workspaces.sql`, `ilm-v2-seed.ts`, `seed-ilm-v2.sql`, `ilm-v2-smoke.ts`.

**`docs/` vs `doc/`:**
- `docs/` is the published Mintlify site (`docs.json` config).
- `doc/` is internal design material (SPEC.md, execution-semantics.md, plans, experimental).

## Key File Locations

**Entry Points:**
- `server/src/index.ts` — server boot (`startServer`).
- `server/src/app.ts` — Express app composition (`createApp`).
- `ui/src/main.tsx` — React entry.
- `ui/src/App.tsx` — router mounted inside providers.
- `cli/src/index.ts` — commander program.
- `packages/db/src/migrate.ts` — standalone migration runner (`pnpm db:migrate`).
- `packages/mcp-server/src/index.ts` — MCP server for Claude integration.

**Configuration:**
- `package.json` (root) — scripts, pnpm overrides, `embedded-postgres` patch.
- `pnpm-workspace.yaml` — workspace member list.
- `tsconfig.base.json`, `tsconfig.json` — TS project refs.
- `vitest.config.ts` (root) — vitest workspace.
- `server/src/config.ts` — runtime config schema and loader.
- `cli/src/config/schema.ts` — CLI config schema stored at `~/.paperclip/config.json`.
- `.env`, `.env.example` — env var templates.
- `Dockerfile`, `docker/` — containerization.

**Core Logic:**
- Issue state machine: `packages/shared/src/lifecycle-states.ts`.
- Transition application: `server/src/services/lifecycle.ts`.
- Event-driven dispatcher: `server/src/services/dispatcher.ts`.
- Watchdog: `server/src/services/watchdog.ts`.
- Legacy heartbeat scheduler: `server/src/services/heartbeat.ts`.
- Budget gate: `server/src/services/budget-guard.ts` and `server/src/services/budgets.ts`.
- Git worktree realization: `server/src/services/workspace-runtime.ts::realizeExecutionWorkspace`.
- Adapter registry: `server/src/adapters/registry.ts`.
- Adapter contract: `packages/adapter-utils/src/types.ts`.
- DB schema barrel: `packages/db/src/schema/index.ts`.

**ILM-v2 specific:**
- Feature flag: `packages/shared/src/feature-flags.ts::isFeatureIlmV2Enabled()`.
- Lifecycle migration: `packages/db/src/migrations/0065_ilm_v2_lifecycle.sql` (adds `lifecycle_state`, `spec_md`, `plan_md`, `handoff_md`, `branch`, `pr_url`, `blocker_reason`, `retry_count` on `issues`; creates `issue_transitions`; installs `trg_issues_merged_terminal` trigger).
- Query/lifecycle DB adapters: `server/src/services/ilm-v2-db-adapter.ts`.
- Watchdog registration: `server/src/index.ts` lines 754-771.

**Testing:**
- Unit/integration: co-located `*.test.ts` beside source (service + UI + shared patterns).
- E2E: `tests/e2e/*` (Playwright) + `tests/release-smoke/`.
- Evals: `evals/promptfoo/`.
- Smoke scripts: `scripts/smoke/*.sh`.
- Root runner: `pnpm test` → `vitest run`; `pnpm test:e2e` → Playwright.

## Naming Conventions

**Files:**
- TypeScript modules: **kebab-case** (`heartbeat-run-summary.ts`, `execution-workspace-policy.ts`, `plugin-job-scheduler.ts`).
- React components and pages: **PascalCase** (`IssueDetail.tsx`, `CommandPalette.tsx`, `Layout.tsx`).
- Test files: sibling with `.test.ts` / `.test.tsx` suffix (`dispatcher.test.ts`, `IssueRow.test.tsx`).
- Storybook: `*.stories.tsx` under `ui/storybook/`.
- SQL migrations: zero-padded sequence + drizzle nickname (`0065_ilm_v2_lifecycle.sql`, `0063_issue_thread_interactions.sql`).
- Ad-hoc / one-shot scripts: leading underscore (`scripts/_fix-runaway.ts`, `scripts/_inspect-run.ts`, `scripts/_seed-paperclip-self-workspace.ts`). Regular scripts have no prefix.

**Directories:**
- Package names (npm + workspace): **kebab-case** with `@paperclipai/` scope (`@paperclipai/db`, `@paperclipai/adapter-claude-local`, `@paperclipai/plugin-sdk`).
- Source directories: **kebab-case** (`routes/`, `services/`, `realtime/`, `home-paths.ts`).
- Adapter packages: `<backend>-local` for local adapters, `<backend>-gateway` for remote (`claude-local`, `codex-local`, `openclaw-gateway`).

**Database:**
- Tables: **snake_case plural** (`issues`, `heartbeat_runs`, `cost_events`, `execution_workspaces`, `project_workspaces`, `agent_wakeup_requests`).
- Columns: **snake_case** (`company_id`, `assignee_agent_id`, `created_at`).
- Drizzle schema objects: **camelCase** (`issues`, `heartbeatRuns`, `costEvents`, `executionWorkspaces`).
- Indexes: `<table>_<cols>_idx` (`issues_company_status_idx`, `cost_events_company_agent_occurred_idx`).
- Constraints: `chk_<table>_<rule>` (`chk_issue_retry_cap`, `chk_issue_blocked_has_reason`).

**Functions & exports:**
- Factory services: `<resource>Service(db)` (`issueService`, `agentService`, `budgetService`).
- Route factories: `<resource>Routes(...)` (`issueRoutes`, `agentRoutes`).
- Hooks: `use<Thing>` (`usePaperclipIssueRuntime`).

## Where to Add New Code

**New feature (full stack):**
1. Schema change: add a new migration file `packages/db/src/migrations/NNNN_<tag>.sql`, and a new schema module under `packages/db/src/schema/<table>.ts` exported from `schema/index.ts`.
2. Shared types: add to `packages/shared/src/types/<resource>.ts` and a zod validator at `packages/shared/src/validators/<resource>.ts`.
3. Service: `server/src/services/<resource>.ts` exporting `<resource>Service(db)`, re-exported from `services/index.ts`. Co-locate `<resource>.test.ts`.
4. Route: `server/src/routes/<resource>.ts`, wired in `server/src/app.ts`.
5. API client: `ui/src/api/<resource>.ts` re-exported from `api/index.ts`.
6. UI page/component: `ui/src/pages/<Resource>.tsx` and/or components under `ui/src/components/`.
7. CLI verbs (optional): `cli/src/commands/client/<resource>.ts` and register in `cli/src/index.ts`.

**New agent adapter:**
1. Create `packages/adapters/<name>/` with `package.json` name `@paperclipai/adapter-<name>`.
2. Implement `src/index.ts` (`type`, `label`, `models`, `agentConfigurationDoc`), `src/server/execute.ts`, `src/server/test.ts`, `src/server/parse.ts`, `src/server/skills.ts` (optional), `src/ui/parse-stdout.ts`, `src/ui/build-config.ts`, `src/cli/format-event.ts`.
3. Add to `server/src/adapters/registry.ts::registerBuiltInAdapters()` and to `BUILTIN_ADAPTER_TYPES` in `builtin-adapter-types.ts`.
4. Add UI-side registration in `ui/src/adapters/registry.ts`.
5. Add CLI-side formatter in `cli/src/adapters/registry.ts`.
6. External plugin alternative: publish a package implementing `createServerAdapter()`; the `plugin-loader.ts` picks it up without touching core.

**New DB table:**
- `packages/db/src/schema/<table>.ts` (Drizzle definition).
- Add export to `packages/db/src/schema/index.ts`.
- `pnpm db:generate` (runs drizzle-kit) then manually finalize the SQL in `packages/db/src/migrations/NNNN_<tag>.sql`. Existing migrations show the expected format (plain SQL, optional `--> statement-breakpoint` delimiter, meta journal auto-updated by drizzle-kit).

**New service:**
- `server/src/services/<resource>.ts` exporting a factory `function <resource>Service(db: Db)`.
- Re-export from `server/src/services/index.ts`.
- Add unit tests as `<resource>.test.ts` in the same directory.

**New UI page:**
- `ui/src/pages/<Page>.tsx` — default export React component.
- Register route in `ui/src/App.tsx`.
- Add API module if new endpoints: `ui/src/api/<resource>.ts` using the typed fetch client from `ui/src/api/client.ts`.
- Add sidebar entry in `ui/src/components/Sidebar.tsx` or `SidebarSection.tsx`.

**New CLI command:**
- Sub-verb on existing namespace: add to `cli/src/commands/client/<resource>.ts` and re-register its `registerXxxCommands(program)` export in `cli/src/index.ts`.
- New top-level command: add a new file under `cli/src/commands/` and wire up in `cli/src/index.ts`.

**Shared utility (used by server + UI + CLI):**
- `packages/shared/src/<util>.ts` — keep dependency-free. Add unit tests as `<util>.test.ts`.

**Script / one-off task:**
- Long-lived operator tool: `scripts/<name>.ts` (no underscore prefix).
- Incident response / one-shot fix: `scripts/_<name>.ts` (underscore prefix).
- Seed data for a company/project: pair an SQL file (`scripts/seed-<name>.sql`) with a TS driver (`scripts/run-<name>-seeds.ts`) so it can be re-applied idempotently.

**Planning docs:**
- User plans for work-in-progress: `~/.paperclip/drafts/<branch-or-project>/` (outside repo, per-operator).
- Long-form design spec: `doc/<TOPIC>.md` or `doc/spec/`.
- Published docs site: `docs/<section>/<topic>.md`, reachable via `docs/docs.json`.
- GSD codebase maps (this file): `.planning/codebase/<NAME>.md`.

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase maps consumed by `/gsd-plan-phase` and `/gsd-execute-phase`.
- Generated: Yes (via `/gsd-map-codebase`).
- Committed: Yes.

**`~/.paperclip/drafts/ILM-v1/` and `~/.paperclip/drafts/ILM-v2/`:**
- Purpose: operator-owned plans for the ILM company's internal agent org. ILM-v1 captured the original 9-agent design (CEO, CTO, BackendEngineer, BackendBurst, FrontendEngineer, FrontendBurst, DataEngineer, DevOpsSRE, SecurityAuditor). ILM-v2 is the in-flight reformulation (CEO, CTO, BackendDev, FrontendDev, DataEng, SecurityAuditor) currently on branch `ilm-v2-reformulation`.
- Generated: No — authored by the operator.
- Committed: No (outside the repo).
- Key files: `NEXT-STEPS.md`, `README.md`, per-agent subfolders, `ILM-v2/BRING-ONLINE-PROMPT.md`.

**`patches/`:**
- Purpose: pnpm patch-package overrides for upstream bugs.
- Committed: Yes.
- Current patch: `embedded-postgres@18.1.0-beta.16.patch` (required for Windows cluster init to work).

**`.agents/` and `.claude/`:**
- Purpose: instructions and skill bundles shipped to agent sessions. `claude_local` mounts `.claude/` as its skill directory; other adapters can use `.agents/`.
- Committed: Yes.

**`skills/`:**
- Purpose: global skills library, copied into agent workspaces by the adapter's skill sync (`syncClaudeSkills`, `syncCodexSkills`, etc.).
- Committed: Yes.

**`releases/`:**
- Purpose: release notes staged for `scripts/create-github-release.sh`.
- Committed: Yes.

**`node_modules/` (multiple):**
- Purpose: pnpm hoists per-workspace deps; every `packages/*`, `server/`, `ui/`, `cli/` has its own.
- Generated: Yes. Committed: No.

---

*Structure analysis: 2026-04-23*
