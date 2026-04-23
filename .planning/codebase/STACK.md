# Technology Stack

**Analysis Date:** 2026-04-23

Paperclip is a self-hosted AI agent orchestration platform — a TypeScript pnpm monorepo that bundles a REST API server, a React board UI, a CLI, an MCP server, and a family of agent adapters (Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Pi, OpenClaw gateway). It uses embedded PostgreSQL by default and ships as an all-in-one Node process.

## Languages

**Primary:**
- TypeScript 5.7.3 — every workspace package (server, ui, cli, adapters, packages/*)
- TSX ESM with `"type": "module"` throughout; `tsconfig.base.json` sets `target: ES2023`, `module: NodeNext`, `strict: true`, `declaration: true`.
- SQL — Drizzle-generated migrations under `packages/db/src/migrations/*.sql` (67 migrations on the `ilm-v2-reformulation` branch).

**Secondary:**
- Bash / shell — release, smoke, and build helpers under `scripts/`, `scripts/smoke/`, `scripts/backup-db.sh`, `scripts/build-npm.sh`, `scripts/release.sh`, `scripts/docker-entrypoint.sh`.
- Dockerfile — `Dockerfile`, `docker/untrusted-review/` for isolated PR review sandboxes.
- Mintlify MDX — user-facing docs under `docs/` (served by `pnpm docs:dev` → `mintlify dev`).

## Runtime

**Environment:**
- Node.js — `engines.node: ">=20"` in `package.json`. Server Dockerfile pins `node:lts-trixie-slim` (Node 22 LTS at time of writing).
- Pure Node runtime (no Bun / Deno). Server is invoked as `node --import tsx/dist/loader.mjs server/dist/index.js` (see `Dockerfile:78`).
- `tsx` 4.19.2 is used as the TypeScript runtime for dev mode, scripts, and the CLI's shebang loader. In production the server is compiled by `tsc` to `server/dist/`.

**Package Manager:**
- pnpm 9.15.4 (`packageManager` field in `package.json`).
- Workspace layout in `pnpm-workspace.yaml`:
  - `packages/*` — `shared`, `db`, `adapter-utils`, `mcp-server`
  - `packages/adapters/*` — `claude-local`, `codex-local`, `cursor-local`, `gemini-local`, `opencode-local`, `pi-local`, `openclaw-gateway`
  - `packages/plugins/*` — `sdk`, `create-paperclip-plugin`, `examples/*` (minus the orchestration-smoke example, which is excluded from the workspace)
  - `server`, `ui`, `cli`
- Lockfile: `pnpm-lock.yaml` present at repo root.
- Corepack is enabled in the Dockerfile; `pnpm install --frozen-lockfile` is used in CI/Docker builds.

**Patched dependencies:**
- `embedded-postgres@18.1.0-beta.16` is patched via `patches/embedded-postgres@18.1.0-beta.16.patch` — the patch forces `LC_MESSAGES=C` and preserves `process.env` when spawning the Postgres child process (fixes locale handling on Windows / non-UTF-8 hosts).
- `pnpm.overrides`: `rollup: ">=4.59.0"` (pinned in `package.json`).

## Frameworks

**Server (`server/`):**
- Express 5.1.0 — HTTP router, route handlers in `server/src/routes/*.ts`, middleware in `server/src/middleware/`.
- better-auth 1.4.18 — email+password auth with Drizzle adapter (`server/src/auth/better-auth.ts`). Session cookies scoped per-instance via `deriveAuthCookiePrefix`.
- ws 8.19.0 — WebSocket live-events server (`server/src/realtime/live-events-ws.ts`).
- pino 9.6.0 + pino-http 10.4.0 + pino-pretty 13.1.3 — structured logging (`server/src/middleware/logger.ts`).
- Zod 3.24.2 — runtime validation of config, API payloads, and shared schemas (`packages/shared/src/config-schema.ts`).
- ajv 8.18.0 + ajv-formats 3.0.1 — JSON Schema validation for plugin manifests.
- multer 2.1.1 — file upload handling.
- jsdom 28.1.0 + dompurify 3.3.2 — server-side HTML sanitization.
- sharp 0.34.5 — image processing for asset pipeline.
- chokidar 4.0.3 — file watcher for dev mode and plugin dev watcher.
- detect-port 2.1.0 — pick a free port if the configured one is busy.
- dotenv 17.0.1 — load `.env` from `$PAPERCLIP_HOME/instances/<id>/.env` and cwd `.env`.
- drizzle-orm 0.38.4 — database access layer; all queries go through it.
- embedded-postgres 18.1.0-beta.16 — bundled Postgres server (see `server/src/index.ts:283` for dynamic import).
- @aws-sdk/client-s3 3.888.0 — optional S3 storage provider (`server/src/storage/s3-provider.ts`).
- open 11.0.0 — open the UI in a browser on startup when `PAPERCLIP_OPEN_ON_LISTEN=true`.
- hermes-paperclip-adapter 0.2.0 — third-party published adapter loaded dynamically.

**UI (`ui/`):**
- React 19.0.0 + react-dom 19.0.0
- Vite 6.1.0 + @vitejs/plugin-react 4.3.4
- Tailwind CSS 4.0.7 via @tailwindcss/vite
- shadcn/ui — configured in `ui/components.json` (style `new-york`, base color `neutral`, `lucide` icons)
- Radix UI — `radix-ui` 1.4.3 primitives, `@radix-ui/react-slot` 1.2.4
- @tanstack/react-query 5.90.21 — server-state cache
- react-router-dom 7.1.5 — client-side routing
- @assistant-ui/react 0.12.23 — agent chat UI primitives
- @dnd-kit/core 6.3.1 + @dnd-kit/sortable 10.0.0 — drag-and-drop on the board
- @mdxeditor/editor 3.52.4 + lexical 0.35.0 + @lexical/link 0.35.0 — rich-text editing for issue docs
- react-markdown 10.1.0 + remark-gfm 4.0.1 — markdown rendering
- mermaid 11.12.0 — diagram rendering
- cmdk 1.1.1 — command palette
- class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.4.1 — Tailwind class utilities
- lucide-react 0.574.0 — icon set
- Storybook 10.3.5 (+ `@storybook/addon-a11y`, `@storybook/addon-docs`, `@storybook/react-vite`) — component workshop (`pnpm storybook`).
- Vite dev server runs on port 5173 with proxy `/api` → `http://localhost:3100` (`ui/vite.config.ts:28-34`).

**CLI (`cli/`):**
- commander 13.1.0 — command parser (`cli/src/index.ts`)
- @clack/prompts 0.10.0 — onboarding TUI prompts
- picocolors 1.1.1 — terminal coloring
- Compiled to a single ESM bundle via esbuild (`cli/esbuild.config.mjs`); the published binary name is `paperclipai` (`cli/package.json:bin`).
- Depends on `@paperclipai/server` as a workspace dep so the CLI can `startServer()` in-process.

**MCP server (`packages/mcp-server/`):**
- @modelcontextprotocol/sdk 1.29.0 — stdio MCP server exposing Paperclip tools (`packages/mcp-server/src/index.ts`).
- Published binary: `paperclip-mcp-server`.

**Plugin SDK (`packages/plugins/sdk/`):**
- Stable public API for Paperclip plugins; worker-side context + UI bridge hooks. React is a peer dependency. Ships `paperclip-plugin-dev-server` bin.

**Testing:**
- Vitest 3.0.5 — unit + integration test runner for all workspaces; root `vitest.config.ts` enumerates workspace projects (`packages/shared`, `packages/db`, `packages/adapter-utils`, `packages/adapters/codex-local`, `packages/adapters/opencode-local`, `server`, `ui`, `cli`).
- @playwright/test 1.58.2 — E2E tests under `tests/e2e/` (configs `tests/e2e/playwright.config.ts`, `tests/e2e/playwright-multiuser-authenticated.config.ts`) and release-smoke under `tests/release-smoke/`.
- supertest 7.0.0 — HTTP testing against the Express app (`server/src/__tests__/`).
- promptfoo 0.103.3 — LLM evals under `evals/promptfoo/` (run via `pnpm evals:smoke`).

**Build / Dev:**
- TypeScript 5.7.3 + `tsc -b` for the UI; `tsc` for server/packages.
- esbuild 0.27.3 — CLI bundler and root dev dep.
- cross-env 10.1.0 — platform-neutral env var injection for dev watch scripts.
- `drizzle-kit` 0.31.9 — schema generation (`pnpm db:generate`).

## Key Dependencies

**Critical:**
- `embedded-postgres@18.1.0-beta.16` (patched) — zero-config Postgres for local installs. Default port **54329**, data dir `$PAPERCLIP_HOME/instances/<id>/db/`. See `server/src/index.ts:280-443` and `packages/shared/src/config-schema.ts:34`.
- `drizzle-orm@0.38.4` + `drizzle-kit@0.31.9` + `postgres@3.4.5` — ORM, migration generator, and Postgres driver. Migrations live in `packages/db/src/migrations/` (67 SQL files, 69 schema files under `packages/db/src/schema/`). Generated migrations are numbered and validated by `packages/db/src/check-migration-numbering.ts`.
- `better-auth@1.4.18` — required when `deploymentMode=authenticated`. Needs `BETTER_AUTH_SECRET` (or `PAPERCLIP_AGENT_JWT_SECRET`) env var (`server/src/auth/better-auth.ts:89`).
- `express@5.1.0` — serves REST API, static UI assets, Vite dev middleware, and better-auth handler mount.
- `zod@3.24.2` — drives config validation, API input validation, and lifecycle/state type generation.
- `@modelcontextprotocol/sdk@1.29.0` — exposes Paperclip to external MCP clients (e.g. Claude Code, Cursor) via stdio.

**Infrastructure:**
- `pino@9.6.0` — structured JSON logs, the canonical logger in `server/src/middleware/logger.ts`.
- `chokidar@4.0.3` — hot reload in dev, plugin dev watcher, workspace runtime file watches.
- `@aws-sdk/client-s3@3.888.0` — optional S3 backend for the storage service (`server/src/storage/s3-provider.ts`).
- `sharp@0.34.5` — image transforms for asset pipeline.
- `multer@2.1.1` — multipart upload handling on asset routes.
- `ws@8.19.0` — WebSocket transport for live events and for the OpenClaw gateway adapter.

**Domain / adapter-specific:**
- `@paperclipai/adapter-utils` — shared runtime helpers (`buildPaperclipEnv`, `runChildProcess`, skill symlink setup, billing inference). Used by every adapter.
- `@paperclipai/adapter-claude-local` — wraps the `claude` CLI (Claude Code). Pricing/billing detection via `ANTHROPIC_API_KEY` (API) vs subscription vs Bedrock (`CLAUDE_CODE_USE_BEDROCK`).
- `@paperclipai/adapter-codex-local` — wraps the `codex` CLI. Billing: `OPENAI_API_KEY` → api, otherwise ChatGPT subscription; `OPENROUTER_API_KEY` or an OpenRouter base URL switches to `openrouter`.
- `@paperclipai/adapter-cursor-local` — wraps the Cursor background-agent CLI.
- `@paperclipai/adapter-gemini-local` — wraps the official `gemini` CLI. Billing: `GEMINI_API_KEY` or `GOOGLE_API_KEY` → api, else subscription.
- `@paperclipai/adapter-opencode-local` — wraps OpenCode CLI (npm `opencode-ai`).
- `@paperclipai/adapter-pi-local` — wraps the `pi` CLI for provider-model routing (`xai/grok-4`, `zai/glm-5.1`, `google/gemini-3.1-pro-preview`). Requires provider-specific env keys (`GEMINI_API_KEY`, `ZAI_API_KEY`, etc.).
- `@paperclipai/adapter-openclaw-gateway` — connects to OpenClaw over a WebSocket gateway (`ws://` / `wss://`); default client id `gateway-client`, role `operator`.

## Configuration

**Environment:**
- `.env` loading order (see `server/src/config.ts:33-44`):
  1. `$PAPERCLIP_HOME/instances/<PAPERCLIP_INSTANCE_ID>/.env`
  2. `$CWD/.env` (only if different from the instance `.env`)
  3. No override: process env takes priority.
- `PAPERCLIP_HOME` defaults to `~/.paperclip`. `PAPERCLIP_INSTANCE_ID` defaults to `default` (`server/src/home-paths.ts:16-27`).
- Key env vars consumed (non-exhaustive):
  - Core: `HOST`, `PORT` (default 3100), `PAPERCLIP_BIND`, `PAPERCLIP_BIND_HOST`, `PAPERCLIP_TAILNET_BIND_HOST`, `PAPERCLIP_PUBLIC_URL`, `PAPERCLIP_ALLOWED_HOSTNAMES`, `PAPERCLIP_DEPLOYMENT_MODE`, `PAPERCLIP_DEPLOYMENT_EXPOSURE`.
  - Database: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `PAPERCLIP_MIGRATION_AUTO_APPLY`, `PAPERCLIP_MIGRATION_PROMPT`, `PAPERCLIP_EMBEDDED_POSTGRES_VERBOSE`.
  - Auth: `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_BASE_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PAPERCLIP_AUTH_PUBLIC_BASE_URL`, `PAPERCLIP_AUTH_BASE_URL_MODE`, `PAPERCLIP_AUTH_DISABLE_SIGN_UP`.
  - Secrets: `PAPERCLIP_SECRETS_PROVIDER`, `PAPERCLIP_SECRETS_STRICT_MODE`, `PAPERCLIP_SECRETS_MASTER_KEY_FILE`.
  - Storage: `PAPERCLIP_STORAGE_PROVIDER`, `PAPERCLIP_STORAGE_LOCAL_DIR`, `PAPERCLIP_STORAGE_S3_BUCKET`, `PAPERCLIP_STORAGE_S3_REGION`, `PAPERCLIP_STORAGE_S3_ENDPOINT`, `PAPERCLIP_STORAGE_S3_PREFIX`, `PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE`.
  - Backups: `PAPERCLIP_DB_BACKUP_ENABLED`, `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES`, `PAPERCLIP_DB_BACKUP_RETENTION_DAYS`, `PAPERCLIP_DB_BACKUP_DIR`.
  - Feature flags: `PAPERCLIP_FEATURE_ILM_V2` (`packages/shared/src/feature-flags.ts`) — gates the ILM-v2 event-driven dispatcher + watchdog (`server/src/index.ts:754-771`).
  - Scheduler: `HEARTBEAT_SCHEDULER_ENABLED`, `HEARTBEAT_SCHEDULER_INTERVAL_MS`.
  - Telemetry: `PAPERCLIP_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `PAPERCLIP_TELEMETRY_ENDPOINT`, `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL`, `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN`.
  - Agent providers: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ZAI_API_KEY` (detected by adapters).
  - MCP client: `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY` (exposed to agent subprocesses so they can call back into Paperclip).

**Config file:**
- JSON config at `$PAPERCLIP_HOME/instances/<id>/config.json` (or nearest `.paperclip/config.json` walked up from cwd). Schema: `packages/shared/src/config-schema.ts` (`paperclipConfigSchema`, `$meta.version: 1`, Zod-validated).
- Fields: `server` (deployment mode/exposure/bind/host/port/allowedHostnames), `auth` (baseUrlMode, publicBaseUrl, disableSignUp), `database` (mode, connectionString, embeddedPostgresDataDir, embeddedPostgresPort, backup), `storage` (local_disk / s3), `secrets` (local_encrypted key path), `logging`, `telemetry`.
- Env vars always override config.json values.

**Build:**
- `tsconfig.base.json` — shared strict TS config; each workspace extends it via its own `tsconfig.json`.
- `server/package.json:build` — `tsc && mkdir -p dist/onboarding-assets && cp -R src/onboarding-assets/. dist/onboarding-assets/`.
- `ui/package.json:build` — `tsc -b && vite build`.
- `cli/package.json:build` — esbuild single-file bundle, chmod +x.
- Root `pnpm build` runs `preflight:workspace-links` then `pnpm -r build`.
- Release: `scripts/release.sh` (canary / stable), GitHub release via `scripts/create-github-release.sh`.

## Platform Requirements

**Development:**
- Node.js ≥ 20, pnpm 9.15.4 (via corepack).
- No host Postgres required — embedded-postgres ships a bundled PG cluster by default.
- Agent CLIs must be installed separately on the host for local adapters to work: `claude`, `codex`, `cursor-agent`, `gemini`, `opencode`, `pi`. The adapters resolve these binaries via `ensureCommandResolvable()` in `@paperclipai/adapter-utils`.
- Optional: `tailscale` CLI (detected at startup for tailnet bind-host auto-discovery — `server/src/config.ts:92-109`).
- Optional: `gh` CLI (installed in the Dockerfile; used by agent skills for PR workflows).

**Production:**
- Docker image built from `Dockerfile` (Node 22 on `node:lts-trixie-slim`). Pre-installs `ca-certificates`, `gosu`, `curl`, `gh`, `git`, `wget`, `ripgrep`, `python3`, `openssh-client`, `jq`.
- Image post-installs `@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai` globally via npm.
- Entry point `scripts/docker-entrypoint.sh` → `node --import tsx-loader server/dist/index.js`.
- Default runtime env: `PAPERCLIP_HOME=/paperclip`, `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PORT=3100`, `HOST=0.0.0.0`.
- Volume: `/paperclip` (persisted data, DB cluster, config, secrets, backups).
- Reverse-proxy friendly: `server.keepAliveTimeout = 185000ms`, `server.headersTimeout = 186000ms` (`server/src/index.ts:623-624`) to outlive ALB/Nginx idle timeouts.

---

*Stack analysis: 2026-04-23*
