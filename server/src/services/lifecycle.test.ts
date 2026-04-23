import { describe, it, expect } from 'vitest';
import { applyTransition, type LifecycleClient, type LifecycleDb } from './lifecycle.js';

/**
 * Mock DB for `applyTransition`.
 *
 * Claude Code runs elevated on Windows and can't boot the embedded-pg
 * helper used elsewhere in the repo. The service's only side effects are
 * four SQL statements (BEGIN, SELECT ... FOR UPDATE, UPDATE, INSERT,
 * COMMIT) so we simulate them on an in-memory issues map + transitions
 * array and assert over the trail.
 */

type IssueRow = {
  id: string;
  lifecycle_state: string;
  handoff_md: string | null;
  spec_md?: string | null;
  plan_md?: string | null;
  branch?: string | null;
  pr_url?: string | null;
  blocker_reason?: string | null;
};

type TransitionRow = {
  issue_id: string;
  from_state: string;
  to_state: string;
  actor_id: string;
  run_id: string | null;
  reason: string | null;
  handoff_md: string | null;
};

type Store = {
  issues: Map<string, IssueRow>;
  transitions: TransitionRow[];
};

function createStore(initial: IssueRow[]): Store {
  return {
    issues: new Map(initial.map((r) => [r.id, { ...r }])),
    transitions: [],
  };
}

function buildMockDb(store: Store): LifecycleDb {
  return {
    async connect(): Promise<LifecycleClient> {
      // Per-transaction working copy; committed on COMMIT.
      let working: Map<string, IssueRow> | null = null;
      let pendingTransitions: TransitionRow[] = [];

      function ensureTx() {
        if (!working) working = new Map(store.issues);
      }

      const client: LifecycleClient = {
        async query<Row = unknown>(
          sql: string,
          params: unknown[] = [],
        ): Promise<{ rows: Row[]; rowCount?: number }> {
          const stmt = sql.trim();
          if (stmt === 'BEGIN') {
            ensureTx();
            return { rows: [] as Row[], rowCount: 0 };
          }
          if (stmt === 'COMMIT') {
            if (working) {
              store.issues = working;
              store.transitions.push(...pendingTransitions);
            }
            working = null;
            pendingTransitions = [];
            return { rows: [] as Row[], rowCount: 0 };
          }
          if (stmt === 'ROLLBACK') {
            working = null;
            pendingTransitions = [];
            return { rows: [] as Row[], rowCount: 0 };
          }
          ensureTx();

          if (stmt.startsWith('SELECT lifecycle_state, handoff_md FROM issues')) {
            const id = params[0] as string;
            const row = working!.get(id);
            if (!row) return { rows: [] as Row[], rowCount: 0 };
            return {
              rows: [
                {
                  lifecycle_state: row.lifecycle_state,
                  handoff_md: row.handoff_md,
                } as unknown as Row,
              ],
              rowCount: 1,
            };
          }

          if (stmt.startsWith('UPDATE issues SET')) {
            // Parse "lifecycle_state=$1, spec_md=$2, ... WHERE id=$N"
            const setClause = stmt.slice(
              stmt.indexOf('SET') + 3,
              stmt.indexOf('WHERE'),
            );
            const assigns = setClause.split(',').map((s) => s.trim());
            const id = params[params.length - 1] as string;
            const row = working!.get(id);
            if (!row) return { rows: [] as Row[], rowCount: 0 };
            for (const a of assigns) {
              const m = a.match(/^(\w+)=\$(\d+)$/);
              if (!m) throw new Error(`bad assign: ${a}`);
              const col = m[1]!;
              const idx = Number(m[2]) - 1;
              (row as Record<string, unknown>)[col] = params[idx] ?? null;
            }
            working!.set(id, row);
            return { rows: [] as Row[], rowCount: 1 };
          }

          if (stmt.startsWith('INSERT INTO issue_transitions')) {
            pendingTransitions.push({
              issue_id: params[0] as string,
              from_state: params[1] as string,
              to_state: params[2] as string,
              actor_id: params[3] as string,
              run_id: (params[4] ?? null) as string | null,
              reason: (params[5] ?? null) as string | null,
              handoff_md: (params[6] ?? null) as string | null,
            });
            return { rows: [] as Row[], rowCount: 1 };
          }

          throw new Error(`unexpected SQL: ${stmt}`);
        },
        release() {
          working = null;
          pendingTransitions = [];
        },
      };
      return client;
    },
  };
}

const ACTOR = '00000000-0000-0000-0000-0000000000a1';
const ISSUE = '00000000-0000-0000-0000-0000000000b1';

const CANONICAL_HANDOFF = `## Handoff
- **From:** BackendDev
- **To:** CTO
- **Next state:** review
- **Summary:** did thing
- **Changed files:** a.ts
- **Tests:** 3 passed
- **Risks:** none
- **Blockers:**`;

describe('applyTransition', () => {
  it('advances inbox → spec_d and records transition row with side-effect', async () => {
    const store = createStore([
      { id: ISSUE, lifecycle_state: 'inbox', handoff_md: null },
    ]);
    const db = buildMockDb(store);
    const r = await applyTransition(db, {
      issueId: ISSUE,
      to: 'spec_d',
      actorId: ACTOR,
      reason: 'spec written',
      sideEffects: { spec_md: '# Spec\n...' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fromState).toBe('inbox');
      expect(r.toState).toBe('spec_d');
    }
    const issue = store.issues.get(ISSUE)!;
    expect(issue.lifecycle_state).toBe('spec_d');
    expect(issue.spec_md).toBe('# Spec\n...');
    expect(store.transitions).toHaveLength(1);
    expect(store.transitions[0]).toMatchObject({
      issue_id: ISSUE,
      from_state: 'inbox',
      to_state: 'spec_d',
      actor_id: ACTOR,
      reason: 'spec written',
    });
  });

  it('rejects invalid transition (inbox → merged)', async () => {
    const store = createStore([
      { id: ISSUE, lifecycle_state: 'inbox', handoff_md: null },
    ]);
    const db = buildMockDb(store);
    const r = await applyTransition(db, {
      issueId: ISSUE,
      to: 'merged',
      actorId: ACTOR,
      reason: 'skip',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid transition/i);
    // Rollback: no transition row, state unchanged.
    expect(store.issues.get(ISSUE)!.lifecycle_state).toBe('inbox');
    expect(store.transitions).toHaveLength(0);
  });

  it('rejects exit-of-implementing without handoff_md', async () => {
    const store = createStore([
      { id: ISSUE, lifecycle_state: 'implementing', handoff_md: null },
    ]);
    const db = buildMockDb(store);
    const r = await applyTransition(db, {
      issueId: ISSUE,
      to: 'review',
      actorId: ACTOR,
      reason: 'done',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/handoff_md required/i);
    expect(store.issues.get(ISSUE)!.lifecycle_state).toBe('implementing');
    expect(store.transitions).toHaveLength(0);
  });

  it('accepts exit-of-implementing when handoff_md supplied in sideEffects', async () => {
    const store = createStore([
      { id: ISSUE, lifecycle_state: 'implementing', handoff_md: null },
    ]);
    const db = buildMockDb(store);
    const r = await applyTransition(db, {
      issueId: ISSUE,
      to: 'review',
      actorId: ACTOR,
      reason: 'ready for review',
      sideEffects: { handoff_md: CANONICAL_HANDOFF },
    });
    expect(r.ok).toBe(true);
    const issue = store.issues.get(ISSUE)!;
    expect(issue.lifecycle_state).toBe('review');
    expect(issue.handoff_md).toBe(CANONICAL_HANDOFF);
    expect(store.transitions).toHaveLength(1);
    expect(store.transitions[0]!.handoff_md).toBe(CANONICAL_HANDOFF);
  });

  it('returns not-found when issue does not exist', async () => {
    const store = createStore([]);
    const db = buildMockDb(store);
    const r = await applyTransition(db, {
      issueId: ISSUE,
      to: 'spec_d',
      actorId: ACTOR,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not found/i);
  });
});
