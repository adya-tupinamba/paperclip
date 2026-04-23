# External Integrations

**Analysis Date:** 2026-04-23

Paperclip is intentionally "self-hosted first": most integrations are process-level (spawn a locally installed agent CLI) or file-system level (`~/.paperclip/`). The only hard external network dependency at runtime is the telemetry ingest endpoint (opt-out). Everything else — databases, AI providers, object storage — is pluggable and defaults to a fully-local install.

## APIs & External Services

**AI agent CLIs (spawned as child processes by adapters):**

- **Claude Code** (`@anthropic-ai/claude-code`) — `@paperclipai/adapter-claude-local`
  - Adapter: `packages/adapters/claude-local/src/server/execute.ts`
  - Invoked via the `claude` binary (configurable via adapter `command` field).
  - Auth modes (detected in `resolveClaudeBillingType`, `execute.ts:89`):
    - `subscription` — Claude Code login session (default; no key needed).
    - `api` — `ANTHROPIC_API_KEY` env var.
    - `metered_api` / Bedrock — `CLAUDE_CODE_USE_BEDROCK=1` or `ANTHROPIC_BEDROCK_BASE_URL` set.
  - Skills auto-symlinked into `~/.claude/skills/` at wake time.
  - Session resume: native Claude Code `--session` flag.

- **OpenAI Codex CLI** (`@openai/codex`) — `@paperclipai/adapter-codex-local`
  - Adapter: `packages/adapters/codex-local/src/server/execute.ts`
  - Invoked via the `codex` binary.
  - Auth modes (`resolveCodexBillingType`, `execute.ts:69`):
    - `api` — `OPENAI_API_KEY` set.
    - `subscription` — ChatGPT login session.
  - Biller override (`resolveCodexBiller`, `execute.ts:74`):
    - `openrouter` when `OPENROUTER_API_KEY` present or `OPENAI_BASE_URL` points at `openrouter.ai`.
  - Codex `$CODEX_HOME` is managed at `packages/adapters/codex-local/src/codex-home.ts` to avoid polluting the user's default `~/.codex/`.

- **Cursor background agent** — `@paperclipai/adapter-cursor-local`
  - Adapter: `packages/adapters/cursor-local/src/server/execute.ts`
  - Invoked via the `cursor-agent` binary.
  - Biller inference identical to Codex (OPENROUTER override support).

- **OpenCode** (`opencode-ai`) — `@paperclipai/adapter-opencode-local`
  - Adapter: `packages/adapters/opencode-local/src/server/execute.ts`
  - Invoked via the `opencode` binary.

- **Gemini CLI** — `@paperclipai/adapter-gemini-local`
  - Adapter: `packages/adapters/gemini-local/src/server/execute.ts`
  - Invoked via the `gemini` binary (official CLI; Antigravity editor/chat CLI is explicitly unsupported).
  - Auth modes (`resolveGeminiBillingType`, `execute.ts:47`):
    - `api` — `GEMINI_API_KEY` or `GOOGLE_API_KEY` set.
    - `subscription` — Gemini CLI login session.
  - Skills auto-symlinked into `~/.gemini/skills/`.
  - Session resume: `--resume` when stored session cwd matches current cwd.
  - Model list: `gemini-3.1-pro`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`, default `auto` (`packages/adapters/gemini-local/src/index.ts:5-13`).

- **Pi CLI** (provider-multiplexer) — `@paperclipai/adapter-pi-local`
  - Adapter: `packages/adapters/pi-local/src/server/execute.ts` (config doc `packages/adapters/pi-local/src/index.ts`)
  - Invoked via the `pi` binary. `model` field is required and must be in `provider/model` format.
  - Routes to upstream providers (env var key in parens):
    - `xai/grok-4` (XAI)
    - `zai/glm-5.1`, `zai/glm-5-turbo`, `zai/glm-5v-turbo` (`ZAI_API_KEY`)
    - `google/gemini-3.1-pro-preview`, `google/gemini-3.1-pro-preview-customtools` (`GEMINI_API_KEY`)
  - Sessions stored in `~/.pi/paperclips/`, resumed with `--session`.

- **OpenClaw Gateway** — `@paperclipai/adapter-openclaw-gateway`
  - Adapter: `packages/adapters/openclaw-gateway/src/server/execute.ts`
  - Transport: WebSocket (`ws://` or `wss://`) via the `ws` package.
  - Auth: handshake headers `x-openclaw-token` / `x-openclaw-auth`, optional shared `password`, optional signed device payload (`disableDeviceAuth` field).
  - Default client identity: `clientId=gateway-client`, `clientMode=backend`, `role=operator`, `scopes=["operator.admin"]`.
  - Auto-pair flow (`autoPairOnFirstConnect=true`) uses `device.pair.list` / `device.pair.approve` RPCs.
  - Exchanges "claimed API key" JSON at `~/.openclaw/workspace/paperclip-claimed-api-key.json` so the remote OpenClaw agent can call the Paperclip API back.

- **Hermes** (`hermes-paperclip-adapter` 0.2.0)
  - Third-party published adapter loaded dynamically at startup (`server/src/index.ts:794` → `waitForExternalAdapters()`).
  - UI wiring: `ui/src/adapters/hermes-local/index.ts`.

**How agent processes call back into Paperclip:**
- The server exports `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, and `PAPERCLIP_RUN_ID` to every adapter subprocess. Agents use `curl` (or their native HTTP tool) against `$PAPERCLIP_API_URL/api/...` with `Authorization: Bearer $PAPERCLIP_API_KEY`. See the prompt-injected usage example in `packages/adapters/gemini-local/src/server/execute.ts:67-78`.

**MCP (Model Context Protocol) server:**
- `@paperclipai/mcp-server` (package `packages/mcp-server/`) exposes Paperclip's surface to external MCP clients (Claude Code, Cursor, etc.) over stdio.
- Binary: `paperclip-mcp-server` (`packages/mcp-server/package.json:16`).
- Uses `@modelcontextprotocol/sdk` 1.29.0 (`McpServer` + `StdioServerTransport`, see `packages/mcp-server/src/index.ts:1-30`).
- Tool definitions constructed in `packages/mcp-server/src/tools.ts`, HTTP client in `packages/mcp-server/src/client.ts`.

**Telemetry backend:**
- Custom Paperclip telemetry service.
- Default endpoints (in order) defined in `packages/shared/src/telemetry/client.ts:9-12`:
  - `https://telemetry.paperclip.ing/ingest`
  - `https://rusqrrg391.execute-api.us-east-1.amazonaws.com/ingest` (AWS API Gateway fallback).
- Override: `PAPERCLIP_TELEMETRY_ENDPOINT`.
- Opt out: `PAPERCLIP_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, or `telemetry.enabled=false` in `config.json`. Also auto-disabled in CI (`CI`, `GITHUB_ACTIONS`, etc.).
- Events tracked (see `packages/shared/src/telemetry/events.ts` exports): `install_started`, `install_completed`, `company_imported`, `project_created`, `routine_created`, `routine_run`, `goal_created`, `agent_created`, `skill_imported`, `agent_first_heartbeat`, `agent_task_completed`, `error_handler_crash`.
- Install ID hashed and persisted at `$PAPERCLIP_HOME/instances/<id>/telemetry/state.json`.

**Feedback / trace export (optional):**
- When `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL` (or legacy `PAPERCLIP_TELEMETRY_BACKEND_URL`) is set, the feedback service flushes pending traces every 5 s via `server/src/services/feedback.ts` + `feedback-share-client.ts`.
- Auth header: `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN` (bearer).

## Data Storage

**Databases:**

- **Embedded PostgreSQL** (default, zero-config)
  - Package: `embedded-postgres@18.1.0-beta.16` (patched; see `patches/embedded-postgres@18.1.0-beta.16.patch`).
  - Data directory: `$PAPERCLIP_HOME/instances/<id>/db/` (default `~/.paperclip/instances/default/db/`). See `packages/shared/src/config-schema.ts:33`.
  - Default port: **54329** (`packages/shared/src/config-schema.ts:34`, `server/src/index.ts:293`).
  - Cluster user / database: `paperclip` / `paperclip` (hard-coded in `server/src/index.ts:382-383`).
  - initdb flags: `--encoding=UTF8 --locale=C --lc-messages=C` — **critical for Windows compatibility** (`server/src/index.ts:386`).
  - Startup logic (`server/src/index.ts:280-443`):
    1. Dynamic import of `embedded-postgres` (optional dep).
    2. If a postmaster.pid with a live process exists → reuse.
    3. Otherwise `detectPort(54329)` — falls back to next free port and persists worktree runtime port.
    4. Stale `postmaster.pid` is removed.
    5. Client object (`embedded-postgres`) is created per process; `stop()` on SIGINT/SIGTERM only if this process started it.

- **External PostgreSQL** (opt-in)
  - Set `DATABASE_URL` env var (or `database.connectionString` in `config.json` with `database.mode=postgres`).
  - Optional separate `DATABASE_MIGRATION_URL` for migrations that need elevated privileges.
  - Client driver: `postgres@3.4.5` via `drizzle-orm/postgres-js` (see `packages/db/src/client.ts:6-50`).

- **Schema / migrations:**
  - Drizzle ORM 0.38.4, schema in `packages/db/src/schema/*.ts` (69 files).
  - Migrations in `packages/db/src/migrations/*.sql` (67 files, sequential 0000–00NN naming, validated by `packages/db/src/check-migration-numbering.ts`).
  - Migration journal: `__drizzle_migrations` table in the `drizzle` schema; `packages/db/src/client.ts` implements an idempotent, self-healing migration applier (`applyPendingMigrations`, `reconcilePendingMigrationHistory`).
  - Startup gate: server refuses to boot with pending migrations unless `PAPERCLIP_MIGRATION_AUTO_APPLY=true` or user answers "y" on the TTY prompt (`server/src/index.ts:114-182`).

- **Backups:**
  - Enabled by default (`databaseBackupEnabled` defaults to `true`).
  - Interval: `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES` (default 60 min).
  - Retention: `PAPERCLIP_DB_BACKUP_RETENTION_DAYS` (default 7 days), read live from instance settings.
  - Directory: `PAPERCLIP_DB_BACKUP_DIR` (default `$PAPERCLIP_HOME/instances/<id>/data/backups`).
  - Implementation: `runDatabaseBackup` in `packages/db/src/backup-lib.ts`; triggered by scheduler in `server/src/index.ts:534-593` and manual endpoint `POST /api/instance/database-backups`.

**File Storage:**

- **Local disk provider** (default)
  - Code: `server/src/storage/local-disk-provider.ts`.
  - Base dir: `PAPERCLIP_STORAGE_LOCAL_DIR` / `storage.localDisk.baseDir` (default `$PAPERCLIP_HOME/instances/<id>/data/storage`).

- **S3-compatible provider** (opt-in)
  - Code: `server/src/storage/s3-provider.ts` using `@aws-sdk/client-s3@3.888.0`.
  - Config fields: `storageS3Bucket` (default `paperclip`), `storageS3Region` (default `us-east-1`), `storageS3Endpoint` (optional, for MinIO/R2/etc.), `storageS3Prefix`, `storageS3ForcePathStyle`.
  - AWS credentials: standard SDK chain (env `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, IRSA, instance metadata, `~/.aws/credentials`).

- **Paperclip `~/.paperclip/` filesystem layout** (see `server/src/home-paths.ts`):
  ```
  ~/.paperclip/                                (PAPERCLIP_HOME)
  └── instances/<PAPERCLIP_INSTANCE_ID>/       (default instance id = "default")
      ├── config.json                          (Zod-validated paperclipConfigSchema)
      ├── .env                                 (loaded by dotenv on startup)
      ├── db/                                  (embedded Postgres cluster, PG_VERSION, postmaster.pid)
      ├── logs/
      ├── secrets/
      │   └── master.key                       (AES key for local_encrypted secrets provider)
      ├── data/
      │   ├── storage/                         (local-disk storage provider root)
      │   └── backups/                         (pg_dump rotation, retention-limited)
      ├── telemetry/
      │   └── state.json                       (installId, lastFlushedAt)
      ├── workspaces/<agentId>/                (per-agent cwd sandbox)
      └── projects/<companyId>/<projectId>/<repoSlug>/
                                                (managed project workspaces / git worktrees)
  ```
- **Worktree roots** for isolated dev instances default to `~/.paperclip-worktrees` (`server/src/worktree-config.ts:135`).
- Adapter plugin registry persisted at `~/.paperclip/adapter-plugins.json` (`server/src/services/adapter-plugin-store.ts:5`).
- Plugin UI assets served from `~/.paperclip/plugins/` (`server/src/routes/plugin-ui-static.ts:190`).
- OpenClaw claimed-key handshake file: `~/.openclaw/workspace/paperclip-claimed-api-key.json` (`packages/adapters/openclaw-gateway/src/index.ts:39`).

**Caching:**
- No Redis / Memcached / external cache.
- In-process TanStack Query on the UI side (`@tanstack/react-query@5.90.21`).
- Server-side caching via Vite dev HTML renderer (`server/src/vite-html-renderer.ts`) and plugin registry service.

## Authentication & Identity

**Auth Provider:**
- **better-auth 1.4.18** — TypeScript auth library with a Drizzle adapter.
  - Integration: `server/src/auth/better-auth.ts` (`createBetterAuthInstance`, `createBetterAuthHandler`, `resolveBetterAuthSession`).
  - Backing tables (in `packages/db/src/schema/auth.ts`): `authUsers`, `authSessions`, `authAccounts`, `authVerifications`.
  - Email+password flow enabled (`emailAndPassword: { enabled: true, requireEmailVerification: false }`). `disableSignUp` is configurable via `auth.disableSignUp` / `PAPERCLIP_AUTH_DISABLE_SIGN_UP`.
  - Session cookies prefixed per-instance: `paperclip-<instanceId>` (see `deriveAuthCookiePrefix`, `server/src/auth/better-auth.ts:32-38`).
  - Required secret: `BETTER_AUTH_SECRET` (falls back to legacy `PAPERCLIP_AGENT_JWT_SECRET`). Startup throws if missing in authenticated mode (`server/src/auth/better-auth.ts:89-95`).

**Deployment modes** (`server/src/config.ts:165-180`, `packages/shared/src/config-schema.ts`):
- `local_trusted` (default) — no auth; only loopback binding allowed (`127.0.0.1`, `::1`, `localhost`). Server auto-seeds a `local-board` principal with `instance_admin` role (`server/src/index.ts:205-258`). Exposes a board-claim URL on startup if the cluster was previously local_trusted.
- `authenticated` — better-auth required. Supports `private` and `public` exposure. Public exposure requires `auth.baseUrlMode=explicit` and `auth.publicBaseUrl`.

**Agent-to-server auth:**
- Agents receive `PAPERCLIP_API_KEY` in their environment; the server verifies bearer tokens via agent JWT logic in `server/src/agent-auth-jwt.ts`.
- CLI auth challenges (device-code-style) via `cli_auth_challenges` table and `server/src/routes/auth.ts`.

**Authorization model:**
- Multi-tenant: `companies`, `company_memberships` (`principalType`, `principalId`, `membershipRole`), `instance_user_roles` (`role` in `instance_admin` | …).
- Per-route guards live in `server/src/routes/authz.ts`, `workspace-command-authz.ts`, `workspace-runtime-service-authz.ts`.

## Monitoring & Observability

**Error Tracking:**
- No Sentry / Datadog / Bugsnag integration. Errors flow into pino logs.

**Logs:**
- `pino@9.6.0` JSON logs, pretty-printed in dev via `pino-pretty`.
- HTTP access logs via `pino-http@10.4.0` (`server/src/middleware/logger.ts`).
- Log redaction rules in `server/src/log-redaction.ts` and `server/src/redaction.ts` to strip bearer tokens, API keys, and secrets from any logged payload.
- Log directory (when `logging.mode=file`): `$PAPERCLIP_HOME/instances/<id>/logs/` (default).

**Metrics / tracing:**
- No OpenTelemetry / Prometheus exporter. First-party telemetry only (see Telemetry backend above).
- A commit-metrics script ships at `scripts/paperclip-commit-metrics.ts` for offline analysis.

## CI/CD & Deployment

**Hosting:**
- Primary target: self-hosted (user's machine / VPS / homelab).
- Container: published Docker image built from root `Dockerfile`. Volume `/paperclip` persists state; exposes port `3100`.
- Hardened review sandbox: `docker/untrusted-review/` with a `bin/review-checkout-pr` helper for isolated PR testing.

**CI Pipeline:**
- GitHub Actions workflow(s) under `.github/workflows/` (e.g. `refresh-lockfile.yml`).
- Release pipeline: `scripts/release.sh` (canary / stable), `scripts/create-github-release.sh`, `scripts/rollback-latest.sh`, `scripts/build-npm.sh`.
- Smoke scripts: `scripts/smoke/openclaw-join.sh`, `scripts/smoke/openclaw-docker-ui.sh`, `scripts/smoke/openclaw-sse-standalone.sh`.
- E2E: Playwright configs in `tests/e2e/` and `tests/release-smoke/`.
- Evals: `evals/promptfoo/` runs via `pnpm evals:smoke`.

**Docs site:**
- Mintlify at `docs/`, invoked with `pnpm docs:dev` → `npx mintlify dev`.

## Environment Configuration

**Required env vars (authenticated production deployment):**
- `BETTER_AUTH_SECRET` — session signing secret (`server/src/auth/better-auth.ts:89`).
- `PAPERCLIP_DEPLOYMENT_MODE=authenticated`.
- `PAPERCLIP_AUTH_PUBLIC_BASE_URL` / `BETTER_AUTH_URL` — needed when `deploymentExposure=public` or `authBaseUrlMode=explicit`.
- `DATABASE_URL` — if not using embedded Postgres.
- `PAPERCLIP_ALLOWED_HOSTNAMES` — when accessed via non-default hostnames.
- Provider keys per enabled adapter: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ZAI_API_KEY`, `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (S3 storage).

**Optional env vars:**
- `PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID` — data directory and instance scoping.
- `PAPERCLIP_CONFIG` — override config path.
- `PAPERCLIP_FEATURE_ILM_V2` — enable the event-driven dispatcher + watchdog replacing the legacy 30 s heartbeat loop (`server/src/index.ts:662-771`).
- `PAPERCLIP_TAILNET_BIND_HOST` — skip `tailscale ip -4` auto-detection.
- `PAPERCLIP_OPEN_ON_LISTEN` — auto-open browser on startup.
- `OPENCODE_ALLOW_ALL_MODELS=true` — set in the Docker image for OpenCode.

**Secrets location:**
- Application-managed secrets (e.g. agent API keys stored per-company) are encrypted with the master key at `$PAPERCLIP_HOME/instances/<id>/secrets/master.key` (AES). Provider interface is `local_encrypted`; `PAPERCLIP_SECRETS_STRICT_MODE` toggles fail-closed behavior.
- Per-company secret tables: `company_secrets`, `company_secret_versions`, `agent_api_keys`, `board_api_keys` (schemas under `packages/db/src/schema/`).
- **Never** read or log `.env` contents; redaction middleware enforces this at log-time.

## Webhooks & Callbacks

**Incoming webhooks:**
- No inbound webhook endpoints from external services (no GitHub / Stripe / Slack webhook receivers). Paperclip does not act as a webhook sink.

**Outgoing HTTP:**
- Telemetry batch POST → `https://telemetry.paperclip.ing/ingest` (with AWS API Gateway fallback). See `packages/shared/src/telemetry/client.ts:61-80`.
- Optional feedback-export POST → `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL` (authenticated with bearer `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN`).
- GitHub raw/API fetches for user-triggered import of GitHub-hosted skills / docs — `server/src/services/github-fetch.ts`. Base URL is derived per-hostname so GitHub Enterprise (`https://<host>/api/v3`) is supported alongside `github.com`. No auth token is attached by default; callers pass init options when they have one.

**Agent-initiated calls:**
- Agents call back into `$PAPERCLIP_API_URL` with `Authorization: Bearer $PAPERCLIP_API_KEY` — routed through `server/src/middleware/auth.ts` → actor middleware.
- OpenClaw gateway dials outbound WebSocket to the remote gateway URL; the remote side then makes inbound calls to Paperclip via the claimed API key.

## GitHub Integration

- **Runtime binary:** `gh` (GitHub CLI) is installed in the Docker image (`Dockerfile:5`) and expected on the host for skill-authored PR workflows. Paperclip itself does **not** shell out to `gh` from the server — git operations are handled by the workspace runtime (`git worktree`, `git clone`, `git fetch`) in `server/src/services/workspace-runtime.ts`, `server/src/services/execution-workspaces.ts`, `server/src/services/company-portability.ts`.
- **Tokens:** no `GITHUB_TOKEN` / `GH_TOKEN` is consumed by the server; auth is delegated to the local `gh` CLI login the agent runs under, or to `git`'s credential helper.
- **HTTP fetches:** `ghFetch` in `server/src/services/github-fetch.ts` makes anonymous fetches against `api.github.com` / `raw.githubusercontent.com` / GitHub Enterprise equivalents; callers can add `Authorization` headers when importing private resources.
- **Fork-and-push reviewer workflow:** documented in `doc/UNTRUSTED-PR-REVIEW.md` and implemented in `docker/untrusted-review/bin/review-checkout-pr`.

---

*Integration audit: 2026-04-23*
