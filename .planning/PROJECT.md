# Paperclip — Self-Hosted ILM Ops

## What This Is

Paperclip is a self-hosted AI agent orchestration platform that runs locally on Adya's Windows notebook to operate the ILM (I Like Music) analytics/CRM fleet. It hosts a single active company (`ILM-v2`, `68892580-9963-4506-a987-90be8d8ddb26`) with 6 agents (CEO/CTO via Claude Code, BackendDev/FrontendDev/DataEng/SecurityAuditor via Codex) that pick up issues from a board, provision git worktrees, run heartbeat loops against external LLM adapters, and drive issues through an 11-state lifecycle from `inbox → merged`.

The platform is a pnpm workspace (server + ui + cli + adapters + packages/db + packages/shared + packages/plugins) running on an embedded Postgres (port 54329), with a Fastify/Express API on :3100 and a React/Vite UI. Adapters for `claude-local`, `codex-local`, `pi-local`, `gemini-local`, and `cursor-local` are pluggable execution backends.

## Core Value

**One thing that must work:** the overnight orchestrator (`packages/db/orchestrate-e2e.ts`) must reliably drive issues through the 11-state lifecycle without infinite-looping, silently burning budget, or corrupting metadata.

Everything else (UI polish, adapter coverage, new features) is downstream of this. On 2026-04-23 the orchestrator bled ~$38 of Claude Opus in an `pr_open → spec_d` retry loop before dying; the same run produced 25+ orphan issues with null projectId/identifier, and DELETE of the legacy company returned 500 on a missing FK cascade. This milestone fixes those classes of failure.

## Current Milestone: v1.0 — Fix paperclip v2 bugs (overnight reliability)

**Goal:** Make the overnight orchestrator safe to leave running unattended — correct state-machine resume, budget circuit breaker, atomic metadata, clean FK cascades, tested Windows patches, reproducible error paths.

**Target features:**
- State machine resume that respects current `lifecycle_state` (no re-entry at `spec_d` when already at `pr_open`)
- Budget circuit breaker (hard-stop when spend approaches `BUDGET_USD_CAP`)
- FK cascade on `cost_events` so DELETE company works
- Worktree path templating fix (`$issue_id` literal → real interpolation)
- Schema validation (Zod at route entry) so POST `/projects`, `/workspaces`, `/issues` return 422 with clear messages instead of 500
- Atomic issue creation (no orphan `projectId=null` / `identifier=null`)
- Windows adapter patches covered by tests + CI guard (symlink/arg-limit fallbacks)
- Test coverage for the overnight loop itself

## Context

**Repo:** `C:\Users\ilm\Documents\GitHub\paperclip`
**Active branch:** `ilm-v2-reformulation` (local + pushed to fork `adya-tupinamba/paperclip`)
**Upstream remote:** `paperclipai/paperclip` (read-only for Adya)
**Personal fork remote:** `adya-tupinamba/paperclip` (push target)
**Platform:** Windows 11 Home, Git Bash shell, pnpm, Node 24.14, tsx 4.21
**DB:** embedded-postgres via `packages/db` — `postgres://paperclip:paperclip@127.0.0.1:54329/paperclip`
**Instance data:** `C:\Users\ilm\.paperclip\instances\default\`
**Ops logs:** `C:\Users\ilm\.paperclip\ops\` (includes `overnight-2026-04-23.log`, `status.json`)
**Codebase map:** `.planning/codebase/` (7 docs, 2097 lines, generated 2026-04-23)

**Why ILM runs self-hosted Paperclip instead of cloud Paperclip:**
- Bearer tokens and Spotify for Artists data never leave the notebook
- Adya controls budget and agent execution directly
- Agents can cd into sibling repos (`ilm`, `lovemoneymusic`, `ilm-coleta`) without provisioning remote workspaces
- Windows-specific patches can be applied without waiting for upstream

## Requirements

### Validated (brownfield — existing capabilities in the codebase)

- ✓ 11-state issue lifecycle (`inbox → spec_d → planned → implementing → review → pr_open → merged` + branches for rejected/failed/blocked/cancelled) — `packages/db/src/schema/issues.ts` + `server/src/services/lifecycle-states.ts`
- ✓ Multi-company / multi-project / multi-agent orchestration (v2 company active, 6 agents, 1 seeded project)
- ✓ Adapter plugin model (Claude/Codex/Pi/Gemini/Cursor) with uniform `execute()` interface — `packages/adapters/*-local/src/server/execute.ts`
- ✓ Windows patches for NTFS symlink perms and CreateProcessW arg-limit — `codex-home.ts:45-90` + `pi-local/execute.ts:342-419`
- ✓ Embedded Postgres DB with drizzle migrations — `packages/db/src/migrations/`
- ✓ Issue lifecycle migration `0065_ilm_v2_lifecycle.sql` with triggers + CHECK constraints
- ✓ Git worktree execution isolation per project
- ✓ Heartbeat loop + wake mechanism
- ✓ Cost tracking in `cost_events` table linked to `heartbeat_runs`
- ✓ Overnight orchestrator driver (`packages/db/orchestrate-e2e.ts`) with Claude-powered CEO spec/decide
- ✓ Dashboard UI at `http://localhost:3100/ILM/dashboard`
- ✓ 186 Vitest tests in `server/src/__tests__/` including ILM-v2 lifecycle, budget-guard, dispatcher, handoff

### Active (v1.0 — this milestone)

- [ ] **ORCH-01**: Orchestrator resume respects current `lifecycle_state` and does not attempt invalid transitions (e.g. `pr_open → spec_d`)
- [ ] **ORCH-02**: Per-issue retry cap stops repeated failed transitions on the same edge within a single orchestrator run
- [ ] **ORCH-03**: Budget circuit breaker halts the orchestrator loop when `spend_today >= BUDGET_USD_CAP` instead of continuing past the cap
- [ ] **DB-01**: DELETE `/api/companies/:id` succeeds for companies with prior heartbeat runs (FK cascade on `cost_events.heartbeat_run_id` resolved)
- [ ] **DB-02**: Issue creation is atomic — `project_id` and `identifier` are never null on insert; `issue_counter` increments reliably
- [ ] **EXEC-01**: Worktree path templates interpolate `${issueId}` correctly — no literal `$issue_id` in provisioned paths; config validator rejects unresolved tokens at load
- [ ] **API-01**: POST `/api/projects`, POST `/api/projects/:id/workspaces`, PATCH `/api/projects/:id`, POST `/api/companies/:id/issues` return 422 with Zod-validated error messages on bad payloads instead of 500
- [ ] **API-02**: Worktree provisioning side-effects in issue/project create are wrapped — failures record a structured error on the row and return 201 with warning, not 500
- [ ] **TEST-01**: Windows patches (`codex-home.ts` symlink fallback, `pi-local/execute.ts` arg-limit fallback) have companion unit tests + CI guard ensuring the fallback code path survives refactors
- [ ] **TEST-02**: Orchestrator resume behavior has integration test covering each `lifecycle_state` entry point (`inbox`, `spec_d`, `planned`, `implementing`, `review`, `pr_open`, `blocked`)
- [ ] **OPS-01**: Post-mortem SQL script documents how to recover from a stuck orchestrator run (force-merge the poisoned issue, backfill orphan metadata) — formalize the one-off scripts from 2026-04-23

### Future (v1.1+ — deferred)

- Dashboard UI polish (currently shows orphan metadata, stale identifiers)
- Multi-user auth beyond the single Adya operator
- Upstream PR back to `paperclipai/paperclip` with the Windows patches + FK fix
- Tier-4 budget handling (hard-stop + resume-with-human-approval)
- Other adapters (`cursor-local`, `openclaw-gateway`) promoted from experimental
- Replace Claude-Opus-in-loop spec generation with a cheaper pre-generation step
- Migration to hosted cloud Paperclip once overnight reliability is proven

### Out of Scope

- Cloud hosting — ILM explicitly runs Paperclip self-hosted so bearer tokens and client data never leave the notebook.
- Multi-tenant auth beyond Adya — the notebook operator is trusted; hardening against untrusted local users is not in this milestone.
- Windows Developer Mode as a prerequisite — the Windows patches exist specifically so Adya can run without Admin/Developer Mode.
- Full rewrite of the adapter interface — patches stay local, upstream PR is future work.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Branch `ilm-v2-reformulation` stays the ILM operational branch, not upstream's `main` | Carries 20+ commits of Windows patches + v2 lifecycle + orchestrator that upstream doesn't know about yet | Validated — branch pushed to fork `adya-tupinamba/paperclip` on 2026-04-23 |
| Soft delete (`PATCH status=archived`) used instead of hard DELETE for the legacy ILM v1 company | DELETE handler has a missing FK cascade on `cost_events.heartbeat_run_id`; soft delete avoids the 500 | Validated (workaround) — real fix tracked as `DB-01` in this milestone |
| Budget cap `BUDGET_USD_CAP=50` was set but did not short-circuit the retry loop | Orchestrator checks budget per-iteration but not per-retry, so 6 `pr_open → spec_d` attempts each invoked Claude Opus independently before the outer counter advanced | Tracked as `ORCH-03` — fix requires per-transition accounting |
| SQL seed/fix scripts followed the `seed-ilm-*.sql` + `run-ilm-*.ts` pattern using `createRequire` anchored at `packages/db/package.json` | Matches existing repo conventions; direct API POSTs to project/workspace/issue endpoints all returned 500 under non-trivial payloads | Validated — 3 fix scripts (`_seed-paperclip-self-workspace.ts`, `_seed-paperclip-fork-push-issue.ts`, `_set-paperclip-self-policy.ts`) ran green on 2026-04-23 |
| Coarse granularity + YOLO mode + research off for this milestone | We already have `.planning/codebase/` (2097 lines, 7 docs) mapping the repo and the 8 bugs are well-understood. Fresh research would duplicate CONCERNS.md | Applied in `config.json` |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-23 after initialization*
