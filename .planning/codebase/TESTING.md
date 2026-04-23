# Testing Patterns

**Analysis Date:** 2026-04-23

## Test Framework

**Runner:** Vitest `^3.0.5` (installed as `vitest@3.2.4` per lockfile).

**Root config:** `vitest.config.ts` uses the Vitest Projects feature to fan out into every workspace that owns tests:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/codex-local",
      "packages/adapters/opencode-local",
      "server",
      "ui",
      "cli",
    ],
  },
});
```

**Per-workspace configs:** Every workspace has its own `vitest.config.ts` declaring `environment: "node"` (default) or using an inline `// @vitest-environment jsdom` pragma for DOM-heavy tests. Current files:
- `server/vitest.config.ts` — node
- `packages/db/vitest.config.ts` — node
- `packages/shared/vitest.config.ts` — node
- `packages/adapter-utils/vitest.config.ts` — node
- `packages/adapters/codex-local/vitest.config.ts` — node
- `packages/adapters/opencode-local/vitest.config.ts` — node
- `packages/adapters/pi-local/vitest.config.ts` — node
- `cli/vitest.config.ts` — node
- `ui/vitest.config.ts` — node, with `@` → `./src` and `lexical` aliases (tests that need DOM use `// @vitest-environment jsdom` at the top of the file)
- `packages/mcp-server/vitest.config.ts`
- `packages/plugins/examples/plugin-authoring-smoke-example/vitest.config.ts`
- `packages/plugins/examples/plugin-orchestration-smoke-example/vitest.config.ts`

**Assertion library:** Vitest's built-in `expect` (chai-based). No jest-dom, no custom matchers beyond `toMatchObject` / `toEqual` / `toBe` / `toHaveBeenCalledWith`.

**HTTP test client:** `supertest@^7.0.0` (`server/package.json` devDependency). Used for Express route tests.

## Run Commands

**Default path** (from `AGENTS.md` §7):
```bash
pnpm test                  # alias for test:run
pnpm test:run              # preflight workspace-links + vitest run (single pass)
pnpm test:watch            # preflight + vitest (watch mode)
```

**Pre-test safety:** Every test command is gated by `preflight:workspace-links` (`package.json` root scripts) which runs `scripts/ensure-workspace-package-links.ts`. This ensures workspace symlinks are valid before vitest resolves `@paperclipai/*` imports — relevant because NTFS symlinks break silently on Windows.

**Per-package typecheck** (runs as part of the full verify):
```bash
pnpm -r typecheck          # all packages
pnpm --filter @paperclipai/server typecheck
```

**Browser suites (opt-in):**
```bash
pnpm test:e2e                                # playwright, tests/e2e/
pnpm test:e2e:headed
pnpm test:e2e:multiuser-authenticated
pnpm test:release-smoke                      # tests/release-smoke/
```

Per `AGENTS.md`: "Browser suites stay opt-in — run only when your change touches them."

**Evals (opt-in):**
```bash
pnpm evals:smoke           # cd evals/promptfoo && promptfoo eval
```

**Full pre-handoff check:**
```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

## Test File Organization

**Server:** Co-located in a single `__tests__` directory per package: `server/src/__tests__/*.test.ts` — 186 files as of this analysis. One file per route/service/unit. File names mirror the target: `health.test.ts` tests `routes/health.ts`, `approvals-service.test.ts` tests `services/approvals.ts`.

**Services with co-located tests:** Some newer ILM-v2 services live next to source:
- `server/src/services/budget-guard.test.ts` ↔ `budget-guard.ts`
- `server/src/services/dispatcher.test.ts` ↔ `dispatcher.ts`
- `server/src/services/handoff.test.ts` ↔ `handoff.ts`
- `server/src/services/lifecycle.test.ts` ↔ `lifecycle.ts`
- `server/src/services/heartbeat-stop-metadata.test.ts`

This mix is intentional — ILM-v2 work introduced co-located tests because the services are self-contained and tested against mocked `DispatcherDb`/`BudgetDb`/`LifecycleDb` interfaces.

**Packages:** Co-located next to source with `*.test.ts` suffix:
- `packages/shared/src/lifecycle-states.test.ts`
- `packages/shared/src/project-mentions.test.ts`
- `packages/shared/src/issue-references.test.ts`
- `packages/shared/src/issue-thread-interactions.test.ts`
- `packages/shared/src/adapter-types.test.ts`
- `packages/shared/src/routine-variables.test.ts`
- `packages/shared/src/workspace-commands.test.ts`
- `packages/db/src/client.test.ts`
- `packages/db/src/backup-lib.test.ts`
- `packages/db/src/runtime-config.test.ts`
- `packages/db/src/embedded-postgres-error.test.ts`
- `packages/adapter-utils/src/billing.test.ts`
- `packages/adapter-utils/src/server-utils.test.ts`
- `packages/adapters/codex-local/src/server/parse.test.ts`
- `packages/adapters/codex-local/src/server/parse-usage.test.ts`
- `packages/adapters/codex-local/src/server/codex-args.test.ts`
- `packages/adapters/codex-local/src/server/quota-spawn-error.test.ts`
- `packages/adapters/codex-local/src/ui/build-config.test.ts`
- `packages/adapters/codex-local/src/ui/parse-stdout.test.ts`
- `packages/adapters/opencode-local/src/server/parse.test.ts`
- `packages/adapters/opencode-local/src/server/models.test.ts`
- `packages/adapters/opencode-local/src/server/runtime-config.test.ts`
- `packages/adapters/openclaw-gateway/src/server/execute.test.ts`
- `packages/adapters/pi-local/src/server/parse.test.ts`
- `packages/adapters/pi-local/src/server/models.test.ts`
- `packages/mcp-server/src/tools.test.ts`

**UI:** Co-located `*.test.ts` / `*.test.tsx` next to source:
- `ui/src/App.test.tsx` (DOM, uses `// @vitest-environment jsdom`)
- `ui/src/components/IssueRow.test.tsx`
- `ui/src/lib/issue-filters.test.ts`
- ~80 UI test files total

**Server tsconfig** excludes `__tests__` from the production build: `"exclude": ["src/__tests__"]` in `server/tsconfig.json`. Tests compile via vitest, not `tsc`.

## Test Structure

**Canonical layout** (copy this shape for new tests):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceUnderTest } from "../services/target.ts";

const mockDep = vi.hoisted(() => ({
  someMethod: vi.fn(),
}));

vi.mock("../services/dependency.js", () => ({
  dependencyService: vi.fn(() => mockDep),
}));

describe("serviceUnderTest behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDep.someMethod.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles the happy path", async () => {
    const result = await serviceUnderTest.doThing("arg");
    expect(result.ok).toBe(true);
  });
});
```

Reference: `server/src/__tests__/approvals-service.test.ts` lines 1-80.

**`describe` block titles:** Describe the subject — `describe("approvalService resolution idempotency", ...)`, `describe("GET /health", ...)`, `describe("lifecycle states", ...)`, `describe("validateHandoff", ...)`.

**`it` block titles:** Describe the behavior as a full sentence — `it("returns 200 when the database probe succeeds", ...)`, `it("rejects merged → anything (terminal)", ...)`, `it("permits inbox → spec_d", ...)`. Read the suite name + `it` as a sentence.

**Timeout override:** Per-test timeout goes as the second arg to `it`. Example from `server/src/__tests__/health.test.ts`:
```ts
it("returns 200 with status ok", async () => { ... }, 15_000);
```

## Mocking

**Framework:** `vi` from `vitest` — `vi.mock`, `vi.fn`, `vi.hoisted`, `vi.spyOn`, `vi.clearAllMocks`, `vi.restoreAllMocks`.

**`vi.hoisted` for module-level mocks:** `vi.mock` calls are hoisted to the top of the file but variables declared with `const` are not — so you can't reference a closure from inside `vi.mock`. The canonical fix: declare the mock inside `vi.hoisted`:

```ts
const mockAgentService = vi.hoisted(() => ({
  activatePendingApproval: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: vi.fn(() => mockAgentService),
}));
```

See `server/src/__tests__/approvals-service.test.ts` line 4-14, `server/src/__tests__/health.test.ts` line 9-14, `ui/src/App.test.tsx` line 9-31.

**Mock lifecycle:** `vi.clearAllMocks()` in `beforeEach` to reset call counts and implementations; `vi.restoreAllMocks()` in `afterEach` to unwind `vi.spyOn` wrappers. Both patterns appear together in route tests — see `server/src/__tests__/health.test.ts` lines 23-30.

**Dynamic imports under spies:** When a test needs to spy on a module AFTER mocking it, use the re-import pattern from `server/src/__tests__/health.test.ts` line 68-74:
```ts
const devServerStatus = await import("../dev-server-status.js");
vi.spyOn(devServerStatus, "readPersistedDevServerStatus").mockReturnValue(undefined);
const { healthRoutes } = await import("../routes/health.js");
```

## Hand-rolled DB Stubs

The dominant mocking idiom for database interactions is **hand-rolled stubs** that match drizzle's fluent builder shape. Tests do NOT wire in a real PostgreSQL client for unit tests — they mock the fluent chain.

**Drizzle-shape stub** (`server/src/__tests__/approvals-service.test.ts` lines 40-56):
```ts
function createDbStub(selectResults: Row[][], updateResults: Row[]) {
  const pendingSelectResults = [...selectResults];
  const selectWhere = vi.fn(async () => pendingSelectResults.shift() ?? []);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(async () => updateResults);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return { db: { select, update }, selectWhere, returning };
}
```

Pass `dbStub.db as any` into the factory. The shape is intentionally duck-typed.

**SQL-pattern-match stub** for ILM-v2 services that speak raw SQL (`server/src/services/budget-guard.test.ts` lines 23-54, `server/src/services/dispatcher.test.ts` lines 40-80):
```ts
function buildMockDb(rows: SeedRow[]): BudgetDb {
  return {
    async query<Row>(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
      if (sql.includes("agent_id=$1") && sql.includes("date_trunc('day'")) {
        // simulate per-agent-daily aggregation
      } else if (sql.includes("usage_json->>'issue_id' = $1")) {
        // simulate per-issue aggregation
      } else {
        throw new Error(`unexpected SQL: ${sql}`);
      }
      ...
    },
  };
}
```

The explicit `throw` in the else branch catches drift — if the service adds a new query shape, the test fails loud.

**Why mock rather than integrate:** `server/src/services/dispatcher.test.ts` line 9-16 documents the rationale:
> "Claude Code runs elevated on Windows and cannot start embedded-postgres, so we simulate the small set of queries dispatcher/budget-guard emit."

## Embedded Postgres for Integration Tests

A subset of tests do spin up real postgres via `packages/db/src/test-embedded-postgres.ts`:

```ts
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("paperclip-db-client-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

describeEmbeddedPostgres("applyPendingMigrations", () => { ... });
```

Reference: `packages/db/src/client.test.ts` lines 1-50. The `describeEmbeddedPostgres` helper auto-skips when embedded-postgres can't start (elevated shells on Windows, missing native libs, sandboxed CI). Use this pattern only for migration/schema tests that cannot be expressed as unit tests.

## Express Route Tests

**Pattern:** Mount the router on a fresh `express()`, drive it with `supertest`:

```ts
import express from "express";
import request from "supertest";
import { healthRoutes } from "../routes/health.js";

function createApp(db?: Db) {
  const app = express();
  app.use("/health", healthRoutes(db));
  return app;
}

it("returns 503 when the database probe fails", async () => {
  const db = { execute: vi.fn().mockRejectedValue(new Error("...")) } as unknown as Db;
  const app = createApp(db);
  const res = await request(app).get("/health");
  expect(res.status).toBe(503);
  expect(res.body).toEqual({ status: "unhealthy", ... });
});
```

Reference: `server/src/__tests__/health.test.ts` lines 16-65.

**Actor injection:** For routes that read `req.actor`, stub it with a middleware before the route mounts:
```ts
app.use((req, _res, next) => {
  (req as any).actor = { type: "board", userId: "user-1", source: "session" };
  next();
});
app.use("/health", healthRoutes(db, opts));
```

Reference: `server/src/__tests__/health.test.ts` lines 139-155.

## React Component Tests

**Environment:** `// @vitest-environment jsdom` pragma at the top of `.tsx` test files (not set globally — only DOM-using tests opt in).

**Render pattern:** Uses `createRoot` from `react-dom/client` + `act` — no `@testing-library/react`. The canonical shape (adapted from `ui/src/App.test.tsx`):

```ts
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("Component", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    // Reset body DOM between tests (see ui/src/App.test.tsx for the production pattern).
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    vi.clearAllMocks();
  });

  it("renders something", async () => {
    // act(() => createRoot(container).render(<Component />));
    // await flushReact();
    // expect(container.textContent).toContain("...");
  });
});
```

Reference: `ui/src/App.test.tsx` lines 1-70. Module-level `IS_REACT_ACT_ENVIRONMENT = true` is required so React's `act` doesn't warn. The repo's own teardown clears the body via jsdom in an equivalent way — match whichever style the surrounding file uses.

## Zod Schema Tests

Validators under `packages/shared/src/validators/*.ts` are tested against both positive and negative inputs with `schema.parse(input)` + `expect(...).toMatchObject(...)`. Reference: `packages/shared/src/issue-thread-interactions.test.ts` lines 4-70. Use `toMatchObject` (partial match) over `toEqual` (exact match) when asserting on schema outputs so adding new optional fields doesn't break the test.

## Lifecycle State Tests

`packages/shared/src/lifecycle-states.test.ts` is the template for enum/state-machine unit tests — assert each allowed transition AND each forbidden one explicitly. Mirror new states in both the `TRANSITIONS` table (`lifecycle-states.ts`) and the test file, plus the corresponding SQL `CHECK` constraint in a new migration.

## Fixtures

No dedicated fixtures directory. Test data is either:
1. **Inline** — literal objects constructed in `beforeEach` or per-test.
2. **Factory functions** — helpers declared at file top that produce records:
   ```ts
   function createApproval(status: string): ApprovalRecord { ... }
   ```
   Reference: `server/src/__tests__/approvals-service.test.ts` line 29-38.
3. **UI fixtures** (React only): `ui/src/fixtures/` exists for tests that want realistic payloads without reconstructing them.

## Coverage

**No enforced threshold.** `vitest.config.ts` files do not define `coverage.thresholds`. Coverage can be run ad-hoc via `pnpm test:run -- --coverage` but isn't part of the default verification path.

## ILM-v2 Test Inventory

The `ilm-v2-reformulation` branch claims "21 tests passing, typecheck clean". The test surface found on the current branch:

- `packages/shared/src/lifecycle-states.test.ts` — 6 tests covering the 11-state machine
- `server/src/services/budget-guard.test.ts` — budget cap guard (per-agent daily, per-agent hourly, per-issue, company daily)
- `server/src/services/dispatcher.test.ts` — pull-next queue + dispatcher hook (mutex, active-run guard)
- `server/src/services/handoff.test.ts` — `validateHandoff` canonical-format parser (4 tests)
- `server/src/services/lifecycle.test.ts` — lifecycle transition application, audit logging, retry cap

**Runtime smoke** (not a vitest test, invoked manually):
- `scripts/ilm-v2-smoke.ts` — end-to-end pipeline smoke: `inbox → spec_d → planned → implementing` driven through the real HTTP API against a seeded DB. Requires `ILM_V2_COMPANY_ID`, `ILM_V2_CEO_ID`, `ILM_V2_CTO_ID`, `ILM_V2_BACKEND_ID` env vars and a running server with `PAPERCLIP_FEATURE_ILM_V2=true`.
- `scripts/ilm-v2-seed.ts` — seeds the ILM-v2 company + agents and prints UUIDs in env-var form for copy-paste into the smoke script.

**Test IDs in SQL:** ILM-v2 tests seed deterministic issue IDs using `randomUUID()` in the test file — see `scripts/ilm-v2-smoke.ts` line 86. Raw SQL seed at `scripts/seed-ilm-v2.sql` uses `gen_random_uuid()` for company/agent rows (not re-runnable-deterministic; the TS wrapper `scripts/ilm-v2-seed.ts` cleans stale rows before re-seeding).

## Common Patterns

**Async testing:** Every I/O test is `async` and awaits the call:
```ts
it("resolves", async () => {
  const r = await service.doThing();
  expect(r.ok).toBe(true);
});
```

**Error testing:** Use vitest's rejection matchers or explicit try/catch with assertion:
```ts
await expect(service.fail()).rejects.toThrow(HttpError);
// or
try { await service.fail(); expect.fail("should have thrown"); }
catch (err) { expect(err).toBeInstanceOf(HttpError); expect((err as HttpError).status).toBe(409); }
```

**Idempotency assertion pattern** (`approvals-service.test.ts`): Drive the same method twice against a stub that returns different rows on the second call, then assert side-effect mocks were NOT called again.

**Snapshot testing:** Rare — only used where a parser produces a stable structured output that's painful to write as literal `toEqual`. Prefer explicit `expect(parsed).toEqual({ ... })` assertions.

## E2E Tests

**Framework:** Playwright `^1.58.2` (`package.json` root devDependency).

**Location:**
- `tests/e2e/` — multi-user onboarding and auth flows
  - `onboarding.spec.ts`
  - `multi-user.spec.ts`
  - `multi-user-authenticated.spec.ts`
  - `signoff-policy.spec.ts`
  - `playwright.config.ts`, `playwright-multiuser.config.ts`, `playwright-multiuser-authenticated.config.ts`
- `tests/release-smoke/` — release-gate smokes (separate `playwright.config.ts`)

**Invocation:** Always through `pnpm test:e2e*` / `pnpm test:release-smoke*`, never directly. Browser suites are opt-in per `AGENTS.md`.

## Evals

`evals/promptfoo/` holds prompt-regression evals, run via `pnpm evals:smoke` (`cd evals/promptfoo && npx promptfoo eval`). These are not part of `pnpm test` and do not gate merges by default.

---

*Testing analysis: 2026-04-23*
