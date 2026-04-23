# Architecture

**Analysis Date:** 2026-04-23

## Pattern Overview

**Overall:** Multi-tenant orchestration platform with pluggable execution backends. Layered architecture: thin REST/WebSocket API over a domain-service layer, with external side-effects delegated to adapter modules. Persistence is PostgreSQL (embedded or external) accessed via Drizzle ORM. Real-time UI updates propagate via a WebSocket event bus.

**Key Characteristics:**
- **Multi-company / multi-project / multi-agent**: every major table is scoped by `company_id` (see `companyId` column in nearly all schemas under `packages/db/src/schema/*.ts`). Companies contain projects; projects contain issues, workspaces, and routines; agents are scoped per-company and assigned to issues.
- **Event-driven dispatcher + watchdog (ILM-v2)** coexists with a legacy 30s polling scheduler (ILM-v1). Selection is controlled by the `PAPERCLIP_FEATURE_ILM_V2` env flag (`packages/shared/src/feature-flags.ts`).
- **Pluggable adapters**: seven built-in agent backends (claude, codex, cursor, gemini, openclaw gateway, opencode, pi) plus `hermes-paperclip-adapter`, `process`, and `http`. External adapters load at startup via a plugin registry.
- **Worktree-isolated execution**: each issue can realize its own `git worktree` branch via a `workspaceStrategy` adapter config, so multiple agents can operate concurrently on the same repo.
- **Budget gates everywhere**: per-agent hourly/daily, per-issue total, and global daily tiers, sourced from `heartbeat_runs.usage_json`.
- **Monorepo**: pnpm workspace with `packages/*`, `packages/adapters/*`, `packages/plugins/*`, `server`, `ui`, `cli` (see `pnpm-workspace.yaml`).

## Layers

**Database schema (`packages/db/`):**
- Purpose: Drizzle PostgreSQL schema, migrations, embedded postgres bootstrap.
- Location: `packages/db/src/`
- Contains: 60+ table schemas, 66 SQL migrations, migration runtime/repair, client factory.
- Depends on: `drizzle-orm`, `postgres` (postgres.js driver), `embedded-postgres` (optional).
- Used by: server, CLI (migrations), standalone scripts.

**Shared types & contracts (`packages/shared/`):**
- Purpose: runtime-agnostic types, validators, constants, lifecycle state machine, feature flags, pricing, telemetry client.
- Location: `packages/shared/src/`
- Contains: `lifecycle-states.ts` (the 11-state machine), API request/response types (`api.ts`), issue/agent/project/etc. type modules under `types/`, zod validators under `validators/`.
- Depends on: zod only (no DB, no network).
- Used by: server, UI, CLI, every adapter, plugin SDK.

**Adapter interface (`packages/adapter-utils/`):**
- Purpose: the `ServerAdapterModule` contract that every agent backend implements, plus shared helpers (billing summaries, stdout parsing, session compaction, child-process runner).
- Location: `packages/adapter-utils/src/`
- Contains: `types.ts` (canonical `AdapterExecutionContext`, `AdapterExecutionResult`, `ServerAdapterModule`), `billing.ts`, `session-compaction.ts`, `server-utils.ts` (`runChildProcess`, env builders, skill readers), `log-redaction.ts`.
- Depends on: nothing heavy — stays side-effect free so adapters can import it.
- Used by: every adapter under `packages/adapters/*` and by `server/src/adapters/`.

**Adapter implementations (`packages/adapters/*`):**
- Purpose: one package per agent backend. Each exports three entrypoints: `server/` (spawn logic, stdout parser, skill sync, env probing), `ui/` (stdout-to-transcript parser, config form schema), `cli/` (debug formatting).
- Location: `packages/adapters/claude-local|codex-local|cursor-local|gemini-local|opencode-local|pi-local|openclaw-gateway/src/{server,ui,cli}`
- Pattern: each adapter package exposes `type`, `label`, `models`, `agentConfigurationDoc` at root; `server/execute.ts`, `server/parse.ts`, `server/skills.ts`, `server/test.ts` on the server side; `ui/parse-stdout.ts`, `ui/build-config.ts` on the UI side.
- Used by: `server/src/adapters/registry.ts` (server import of `.../server` entry), `ui/src/adapters/*` (UI import of `.../ui` entry).

**Adapter registry (`server/src/adapters/`):**
- Purpose: maps `adapter_type` string to a concrete `ServerAdapterModule`. Handles built-in registration, external plugin loading, override/pause logic, and fallback to a generic `process` adapter.
- Location: `server/src/adapters/`
- Key files: `registry.ts` (adapter map + override semantics), `plugin-loader.ts` (dynamic import of external adapter packages), `builtin-adapter-types.ts` (set of types known to be built-in), `process/execute.ts` and `http/execute.ts` (the two generic fallback adapters), `types.ts` (re-exports from `adapter-utils`).

**Server services (`server/src/services/`):**
- Purpose: domain logic. Pure TypeScript modules that take a Drizzle `Db` and return service objects with methods.
- Location: `server/src/services/`
- Pattern: each file exports a factory function (`issueService(db)`, `agentService(db)`, etc.) and is re-exported from `services/index.ts`.
- Key files:
  - `heartbeat.ts` — legacy ILM-v1 scheduler: tickTimers, reapOrphanedRuns, promoteDueScheduledRetries, resumeQueuedRuns, reconcileStrandedAssignedIssues, issue-graph liveness.
  - `dispatcher.ts` — ILM-v2 event-driven wake: `dispatcherHook({issueId, toState: 'implementing'})` + `pullNextForAgent(agentId)`.
  - `watchdog.ts` — ILM-v2 5-minute tick killing stale `running` heartbeat_runs, bumping retry_count, escalating to `failed` after 3 retries.
  - `lifecycle.ts` — transactional `applyTransition(db, {issueId, to, actorId, ...})` enforcing the 11-state machine from `packages/shared/src/lifecycle-states.ts`.
  - `budget-guard.ts` — four-tier budget check against `heartbeat_runs.usage_json.costUsd`.
  - `workspace-runtime.ts` — `realizeExecutionWorkspace()` (git worktree creation), `ensureRuntimeServicesForRun`, cleanup.
  - `execution-workspace-policy.ts` — resolves project/issue execution-workspace preferences into a concrete `workspaceStrategy`.
  - `routines.ts` — cron + webhook-triggered recurring tasks, coalesced by fingerprint.
  - `ilm-v2-db-adapter.ts` — builds the duck-typed `QueryDb`/`LifecycleDb` shapes the v2 services consume, wrapping the Drizzle pool.
- Depends on: `@paperclipai/db`, `@paperclipai/shared`, adapter registry, telemetry.
- Used by: route handlers, scheduler loops in `server/src/index.ts`, CLI (indirectly via API).

**HTTP API (`server/src/routes/`):**
- Purpose: Express routers exposing REST endpoints. One file per resource.
- Location: `server/src/routes/`
- Pattern: each module exports a `<name>Routes(db)` function returning a mounted `express.Router`. `routes/index.ts` wires them all up in `app.ts`.
- Coverage (partial): `issues.ts`, `issues-transition.ts`, `agents.ts`, `agents-pull-next.ts`, `projects.ts`, `companies.ts`, `execution-workspaces.ts`, `routines.ts`, `approvals.ts`, `costs.ts`, `dashboard.ts`, `auth.ts`, `access.ts`, `plugins.ts`, `adapters.ts`, `health.ts`, `ops.ts`, plus ~20 more.

**Realtime (`server/src/realtime/`):**
- Purpose: WebSocket fan-out of live events to subscribed clients.
- Location: `server/src/realtime/live-events-ws.ts` + `server/src/services/live-events.ts`.
- Pattern: publishers call `publishLiveEvent(companyId, event)`, clients subscribe via `/ws/live-events?companyId=...` with optional bearer auth.

**Auth & middleware (`server/src/auth/`, `server/src/middleware/`):**
- Purpose: deployment-mode gating (`local_trusted` vs `authenticated`), BetterAuth integration, board mutation guard, private-hostname guard, actor resolution.
- Location: `server/src/auth/better-auth.ts`, `server/src/middleware/{auth,board-mutation-guard,private-hostname-guard,logger,validate}.ts`.

**Storage (`server/src/storage/`):**
- Purpose: attachment/asset pluggable backend (local disk or S3). `StorageService` is injected into `createApp`.
- Key files: `local-disk-provider.ts`, `s3-provider.ts`, `provider-registry.ts`, `service.ts`.

**Plugin host (`server/src/services/plugin-*.ts`):**
- Purpose: run external plugins that extend Paperclip with new UI surfaces, tools, webhooks, jobs, and DB namespaces. Plugins are loaded via `plugin-loader.ts` from `${PAPERCLIP_HOME}/plugins`.
- Key files: `plugin-registry.ts`, `plugin-worker-manager.ts`, `plugin-job-scheduler.ts`, `plugin-event-bus.ts`, `plugin-database.ts`, `plugin-lifecycle.ts`, `plugin-dev-watcher.ts`.
- Plugin SDK is at `packages/plugins/sdk/` and MCP server at `packages/mcp-server/`.

**UI (`ui/src/`):**
- Purpose: React SPA for operators. Served by the same Express server in static mode, or via a Vite middleware in dev.
- Entry: `ui/src/main.tsx` → `App.tsx` (router) → pages under `pages/`.
- State: TanStack Query (`ui/src/lib/queryKeys.ts`) over a typed API client (`ui/src/api/*.ts`). React Context providers for company, breadcrumbs, live updates, theme, dialogs.
- Adapter UI per backend lives in `ui/src/adapters/<type>/` and is registered via `ui/src/adapters/registry.ts`.
- Plugin UI surfaces load from `/api/plugins/:id/ui` (`server/src/routes/plugin-ui-static.ts`) and render into slots exposed by `ui/src/plugins/slots.tsx`.

**CLI (`cli/src/`):**
- Purpose: operator-facing commands (onboard, doctor, run, heartbeat run, db backup, worktree, context, company, issue, agent, approval, routine, feedback, plugin, auth).
- Entry: `cli/src/index.ts` (commander.js).
- Pattern: each command is a module under `commands/`. Client calls go through `cli/src/client/http.ts`.

## Data Flow

**Issue lifecycle (ILM-v2, feature flag on):**

1. Operator (UI) or routine creates an `issues` row with `lifecycle_state='inbox'`.
2. `POST /api/issues/:id/transition` → `server/src/routes/issues-transition.ts` calls `applyTransition()` in `server/src/services/lifecycle.ts`.
3. `applyTransition` opens a transaction, `SELECT ... FOR UPDATE` on the row, validates against `isValidTransition()` from `packages/shared/src/lifecycle-states.ts`, writes side-effects (`spec_md`, `plan_md`, `handoff_md`, `branch`, `pr_url`, `blocker_reason`), inserts an `issue_transitions` audit row.
4. On `toState='implementing'`, `dispatcherHook()` in `server/src/services/dispatcher.ts` runs: checks that the assignee has no `heartbeat_runs.status='running'`, that `checkBudget()` passes, and that no other issue on the same `project_id` is already implementing (repo mutex). If clear, calls `wake({agentId, issueId})`.
5. `wake` inserts an `agent_wakeup_requests` row, which the scheduler picks up and hands to `heartbeatService.runOnce()`. A `heartbeat_runs` row is created with `status='queued'` then `running`, `context_snapshot.issueId` is stamped so the watchdog can find it.
6. The run resolves the adapter via `requireServerAdapter(agent.adapter_type)`, calls `adapter.execute(ctx)` after realizing the execution workspace (`realizeExecutionWorkspace` → git worktree if `workspaceStrategy.type === 'git_worktree'`). Stdout streams into `run_log_store`, tokens/cost roll up to `cost_events` and `agent_runtime_state`.
7. Agent completes → writes a `handoff_md` side-effect via API → issues another transition (e.g. `implementing → review`). Exit from `implementing` or `review` requires a non-empty `handoff_md` that passes `validateHandoff()`.
8. `review → pr_open → merged` finishes the flow. `merged` is terminal (Postgres trigger `trg_issues_merged_terminal` in migration `0065`). `blocked` requires a `blocker_reason` (CHECK constraint).
9. Watchdog (`server/src/services/watchdog.ts`) ticks every 5 minutes: runs `running` more than 20 minutes old are marked `timeout`, the source issue's `retry_count` is incremented, and at `retry_count >= 3` + still `implementing` the issue is transitioned to `failed` via `applyTransition`.

**Wake mechanism (legacy ILM-v1, feature flag off):**

1. `server/src/index.ts` sets `setInterval(tickTimers, heartbeatSchedulerIntervalMs)` — default 30s.
2. Each tick: `heartbeatService.tickTimers(now)` scans `agents` with due `intervalSec`, enqueues `agent_wakeup_requests`. `routineService.tickScheduledTriggers(now)` does the same for routine crons.
3. Periodic housekeeping: `reapOrphanedRuns({staleThresholdMs: 5min})`, `promoteDueScheduledRetries()`, `resumeQueuedRuns()`, `reconcileStrandedAssignedIssues()`, `reconcileIssueGraphLiveness()`.

**State Management:**
- Server: stateless Express handlers; all durable state in PostgreSQL. In-memory maps only for `runningProcesses` (PID bookkeeping) and `adaptersByType` (plugin registry).
- UI: TanStack Query cache hydrated from REST responses; live invalidations driven by WebSocket events from `LiveUpdatesProvider` (`ui/src/context/LiveUpdatesProvider.tsx`).

## Key Abstractions

**`ServerAdapterModule`:**
- Purpose: the contract every agent backend implements.
- Location: `packages/adapter-utils/src/types.ts` (defined) and `server/src/adapters/types.ts` (re-exported).
- Required methods: `execute(ctx)`, `testEnvironment(ctx)`. Optional: `listSkills`, `syncSkills`, `sessionCodec`, `sessionManagement`, `listModels`, `getQuotaWindows`, `detectModel`, `getConfigSchema`, `onHireApproved`.
- Capability flags: `supportsLocalAgentJwt`, `supportsInstructionsBundle`, `requiresMaterializedRuntimeSkills`, `instructionsPathKey`.
- Registered via `adaptersByType.set(type, module)` in `server/src/adapters/registry.ts`.

**`LifecycleState`:**
- Purpose: canonical 11-state issue machine.
- Location: `packages/shared/src/lifecycle-states.ts`.
- States: `inbox | spec_d | planned | implementing | review | pr_open | merged | blocked | rejected | failed | changes_requested`.
- Transitions: encoded in `TRANSITIONS` table; `merged` and `rejected` are terminal; `blocked` can return to any earlier state; `failed` loops back to `implementing` for retry.

**`ExecutionWorkspace` / `ProjectWorkspace`:**
- Purpose: the concrete directory + ref where an agent runs. Separates the long-lived "project workspace" (developer's local clone) from the ephemeral "execution workspace" (per-issue worktree).
- Schemas: `packages/db/src/schema/project_workspaces.ts` and `packages/db/src/schema/execution_workspaces.ts`.
- Strategy field: `execution_workspaces.strategy_type` is one of `project_primary | git_worktree`. Git-worktree realization is in `server/src/services/workspace-runtime.ts::realizeExecutionWorkspace` (reads `agent.adapterConfig.workspaceStrategy = { type: 'git_worktree', baseRef?, branchTemplate?, worktreeParentDir? }`, default branch template `{{issue.identifier}}-{{slug}}`, default parent `<repoRoot>/.paperclip/worktrees/`).
- Runtime services (dev servers, DBs) attached to workspaces are tracked in `workspace_runtime_services` and managed by `local-service-supervisor.ts`.

**`HeartbeatRun`:**
- Purpose: one agent invocation. Carries PID, process group, session ids, usage, cost, liveness state, retry lineage, and a JSON `context_snapshot` that stamps the issue association for watchdog lookup.
- Schema: `packages/db/src/schema/heartbeat_runs.ts`.
- Log payload: `logStore='run_log_store'`, `logRef` points to a blob in `server/src/services/run-log-store.ts`.
- Canonical cost write: `heartbeat_runs.usage_json.costUsd` (every adapter writes this flat key).

**`Routine`:**
- Purpose: recurring or webhook-triggered task template that enqueues issues.
- Schemas: `packages/db/src/schema/routines.ts` (`routines`, `routine_triggers`, `routine_runs`).
- Coalescing: `concurrencyPolicy` (e.g. `coalesce_if_active`), `catchUpPolicy`, `dispatchFingerprint` prevents duplicate issues per window.

**`CompanyMembership` / `PrincipalPermissionGrant`:**
- Purpose: RBAC. Users or agents (principals) hold memberships scoped to a company with a `membershipRole`, plus fine-grained grants.
- Schemas: `packages/db/src/schema/company_memberships.ts`, `principal_permission_grants.ts`, `instance_user_roles.ts`.

## Entry Points

**Server boot:**
- Location: `server/src/index.ts::startServer()`
- Triggers: `paperclipai run` CLI command, `pnpm dev`, direct `node dist/index.js`.
- Responsibilities: load config → bootstrap DB (external URL or embedded postgres in `${PAPERCLIP_HOME}/data`) → run pending migrations (prompt, auto-apply on first run) → create `Db` → ensure local trusted board principal → mount Express app (`createApp`) → WebSocket live events → ILM-v1 scheduler setInterval OR ILM-v2 watchdog registration → wait for external adapters → listen.

**Express app:**
- Location: `server/src/app.ts::createApp(db, opts)`
- Composes middleware (logger, actor resolver, private hostname guard, board mutation guard) and mounts all `server/src/routes/*` modules.

**CLI:**
- Location: `cli/src/index.ts`
- Registers commander subcommands: `onboard`, `doctor`, `env`, `configure`, `db:backup`, `allowed-hostname`, `run`, `heartbeat run`, `auth bootstrap-ceo`, plus `registerCompanyCommands`, `registerIssueCommands`, `registerAgentCommands`, etc. from `commands/client/*.ts`.

**UI:**
- Location: `ui/src/main.tsx`
- Mounts React tree with 11 nested context providers (`ThemeProvider`, `BrowserRouter`, `CompanyProvider`, `EditorAutocompleteProvider`, `ToastProvider`, `LiveUpdatesProvider`, `TooltipProvider`, `BreadcrumbProvider`, `SidebarProvider`, `PanelProvider`, `PluginLauncherProvider`, `DialogProvider`). Registers service worker at `/sw.js`.

**Adapter invocation:**
- Location: `server/src/services/heartbeat.ts` (legacy path) and `server/src/services/dispatcher.ts` (ILM-v2 path).
- Both ultimately call `getServerAdapter(type).execute(ctx)` from `server/src/adapters/registry.ts`.

## Error Handling

**Strategy:** typed `HttpError` subclasses thrown from services; `server/src/errors.ts` exports `conflict`, `notFound`, `badRequest`, etc. Caught by `server/src/middleware/error-handler.ts` which maps to HTTP status + structured JSON.

**Patterns:**
- Budget violations: `checkBudget()` returns `{ok: false, reason}` — never throws. Callers translate into 402/409 or silent skip.
- Adapter execution failures: `AdapterExecutionResult.exitCode` + `errorCode` are persisted on `heartbeat_runs`; the run transitions to `failed`/`timeout`/`error` without throwing.
- Watchdog timeouts: handled entirely as UPDATEs, no exception path. Retry cap `retry_count <= 3` enforced by CHECK constraint (`chk_issue_retry_cap`).
- Migration drift: `reconcilePendingMigrationHistory()` in `packages/db/src/client.ts` repairs journal entries when schema matches but the drizzle `__drizzle_migrations` table disagrees.
- Embedded postgres crashes: `formatEmbeddedPostgresError()` captures the last 120 log lines via `createEmbeddedPostgresLogBuffer()` and attaches them to the thrown error.

## Cross-Cutting Concerns

**Logging:** pino (`server/src/middleware/logger.ts`). Redaction via `server/src/log-redaction.ts` strips current-user text and known secret patterns. Adapter-side redaction in `packages/adapter-utils/src/log-redaction.ts`.

**Validation:** zod schemas in `packages/shared/src/validators/*.ts`, applied by `server/src/middleware/validate.ts` middleware.

**Authentication:**
- Two deployment modes: `local_trusted` (loopback-only, one synthetic `local-board` admin auto-provisioned) and `authenticated` (BetterAuth integration via `server/src/auth/better-auth.ts`).
- Bearer tokens for agents: `agent_api_keys` table + `server/src/agent-auth-jwt.ts` issues short-lived JWTs for local adapters (`supportsLocalAgentJwt: true`).
- Board-specific keys: `board_api_keys` for the board/admin CLI flow.
- Webhook triggers authenticate via `routine_triggers.secretId` (HMAC).

**Secrets:** pluggable provider pattern under `server/src/secrets/`. Local provider uses symmetric encryption with `PAPERCLIP_SECRETS_MASTER_KEY_FILE`. Stored in `company_secrets` + `company_secret_versions` for rotation.

**Telemetry:** `@paperclipai/shared/telemetry` exports `initTelemetry`, event factories (`trackAgentFirstHeartbeat`, etc.). Server wires up via `server/src/telemetry.ts`.

**Feature flags:** minimal — `packages/shared/src/feature-flags.ts::isFeatureIlmV2Enabled()` reads `PAPERCLIP_FEATURE_ILM_V2`.

**Repo mutex:** enforced in `dispatcherHook()` by refusing to wake when another issue in the same `project_id` is already `implementing`. Augmented by git worktrees so concurrent non-mutually-exclusive work on separate branches remains possible.

---

*Architecture analysis: 2026-04-23*
