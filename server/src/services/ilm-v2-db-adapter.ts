/**
 * ILM-v2 DB adapter — strategy (a).
 *
 * The new lifecycle/budget/dispatcher services were written against a
 * minimal duck-typed DB interface (`{query(sql, params) => Promise<{rows,
 * rowCount}>}` and `{connect() => Promise<{query, release}>}` for the
 * transactional service). The paperclip repo uses `postgres` (postgres.js)
 * via drizzle, not `pg.Pool`, so at the route layer we wrap the drizzle
 * `Db`'s underlying `postgres` client (`db.$client`) into that shape.
 *
 * Why not drizzle's own helpers?
 *   - `db.execute(sql.raw(text))` refuses params.
 *   - Drizzle's tagged `sql` template requires us to rebuild `$1..$N` into
 *     `${val}` interpolations, which would fight `applyTransition`'s
 *     hand-written SQL for no gain.
 *   - `sql.unsafe(text, params)` is the native postgres-js primitive for
 *     parameterized raw queries, and `sql.reserve()` returns a connection
 *     that supports manual `BEGIN / COMMIT / ROLLBACK` — exactly what
 *     `applyTransition` expects.
 */
import type { Db } from "@paperclipai/db";
import type { BudgetDb } from "./budget-guard.js";
import type { DispatcherDb } from "./dispatcher.js";
import type { LifecycleDb, LifecycleClient } from "./lifecycle.js";

type PgClient = {
  unsafe<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Row[]>;
  reserve(): Promise<PgReserved>;
};

type PgReserved = PgClient & {
  release(): void;
};

function getPgClient(db: Db): PgClient {
  const client = (db as unknown as { $client?: PgClient }).$client;
  if (!client || typeof client.unsafe !== "function" || typeof client.reserve !== "function") {
    throw new Error("ilm-v2 adapter: db.$client is not a postgres-js client");
  }
  return client;
}

function wrapRows<Row>(rows: Row[]): { rows: Row[]; rowCount: number } {
  return { rows, rowCount: rows.length };
}

/**
 * Build a `{query}` adapter suitable for `BudgetDb` and `DispatcherDb`.
 */
export function buildQueryDb(db: Db): BudgetDb & DispatcherDb {
  const client = getPgClient(db);
  return {
    async query<Row = unknown>(sqlText: string, params: unknown[] = []) {
      const rows = await client.unsafe<Row>(sqlText, params);
      return wrapRows(rows);
    },
  };
}

/**
 * Build a `{connect}` adapter for `LifecycleDb`. The returned client
 * exposes a `query` that proxies to a reserved connection plus a
 * `release` that returns it to the pool.
 */
export function buildLifecycleDb(db: Db): LifecycleDb {
  const client = getPgClient(db);
  return {
    async connect(): Promise<LifecycleClient> {
      const reserved = await client.reserve();
      return {
        async query<Row = unknown>(sqlText: string, params: unknown[] = []) {
          const rows = await reserved.unsafe<Row>(sqlText, params);
          return wrapRows(rows);
        },
        release(): void {
          reserved.release();
        },
      };
    },
  };
}
