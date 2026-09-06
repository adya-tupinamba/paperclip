-- Seed ILM company v1.2.
--
-- Creates in one transaction:
--   1 company  ILM (prefix ILM, budget 50000 cents = US$500/month)
--   9 agents   CEO + 7 core ICs/specialists + 2 burst workers
--   1 goal     Operacao continua ILM (ownerAgent = CEO)
--   3 projects analytics-platform, crm-surface, ingestion-engine
--
-- Specialist lane:
--   CTO and DataEngineer run on pi_local with google/gemini-3.1-pro-preview (thinking=high).
--   SecurityAuditor runs on pi_local with zai/glm-5.1 (thinking=high) - leverages ZAI subscription for audit.
--   Other ZAI models available on the host: zai/glm-5-turbo (latency-tuned), zai/glm-5v-turbo (multimodal).
-- Burst lane:
--   BackendBurst and FrontendBurst are seeded paused until Cursor Agent CLI is
--   available on the runtime host.
--
-- Workspace:
--   git_worktree with parent dir C:\Users\ilm\Documents\GitHub\ilm-worktrees
--
-- Instructions:
--   ~/.paperclip/drafts/ILM-v1/<Role>/AGENTS.md
--
-- APPLY:
--   1. pnpm dev:server
--   2. Wait for migrations and embedded-postgres on 54329.
--   3. Run:
--        psql "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip" -f scripts/seed-ilm-company.sql
--      or:
--        pnpm exec tsx -e "import postgres from 'postgres'; import fs from 'node:fs'; const sql=postgres('postgres://paperclip:paperclip@127.0.0.1:54329/paperclip'); await sql.unsafe(fs.readFileSync('scripts/seed-ilm-company.sql','utf8')); await sql.end();"

BEGIN;

DO $$
DECLARE
  company_uuid         uuid := gen_random_uuid();
  ceo_uuid             uuid := gen_random_uuid();
  cto_uuid             uuid := gen_random_uuid();
  data_eng_uuid        uuid := gen_random_uuid();
  backend_uuid         uuid := gen_random_uuid();
  frontend_uuid        uuid := gen_random_uuid();
  devops_uuid          uuid := gen_random_uuid();
  security_uuid        uuid := gen_random_uuid();
  backend_burst_uuid   uuid := gen_random_uuid();
  frontend_burst_uuid  uuid := gen_random_uuid();
  goal_uuid            uuid := gen_random_uuid();
  proj_analytics       uuid := gen_random_uuid();
  proj_crm             uuid := gen_random_uuid();
  proj_ingestion       uuid := gen_random_uuid();

  drafts_root text := 'C:\Users\ilm\.paperclip\drafts\ILM-v1';
  repo_ilm    text := 'C:\Users\ilm\Documents\GitHub\ilm';
  repo_coleta text := 'C:\Users\ilm\Documents\GitHub\ilm-coleta';
  repo_lmm    text := 'C:\Users\ilm\Documents\GitHub\lovemoneymusic';
  worktree_parent text := 'C:\Users\ilm\Documents\GitHub\ilm-worktrees';
BEGIN
  INSERT INTO companies (
    id, name, description, status,
    issue_prefix, issue_counter,
    budget_monthly_cents, spent_monthly_cents,
    require_board_approval_for_new_agents,
    feedback_data_sharing_enabled
  ) VALUES (
    company_uuid,
    'ILM',
    'I Like Music - analytics musical + CRM para artistas brasileiros.',
    'active',
    'ILM', 0,
    50000, 0,
    true,
    false
  );

  -- CEO ---------------------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    ceo_uuid, company_uuid,
    'CEO', 'ceo', 'Chief Executive Officer',
    'idle', NULL,
    'claude_local',
    jsonb_build_object(
      'model', 'claude-opus-4-7',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\CEO\AGENTS.md',
      'timeoutSec', 900,
      'graceSec', 30,
      'maxTurnsPerRun', 10,
      'env', jsonb_build_object(
        'CLAUDE_CONFIG_DIR', 'C:\Users\ilm\.claude-paperclip'
      )
    ),
    '{}'::jsonb, 2500, '{}'::jsonb
  );

  -- CTO specialist lane ----------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    cto_uuid, company_uuid,
    'CTO', 'cto', 'Chief Technology Officer',
    'idle', ceo_uuid,
    'pi_local',
    jsonb_build_object(
      'model', 'google/gemini-3.1-pro-preview',
      'thinking', 'high',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\CTO\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 7500, '{}'::jsonb
  );

  -- DataEngineer specialist lane -------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    data_eng_uuid, company_uuid,
    'DataEngineer', 'data_engineer', 'Data Engineer (Spotify ingestion)',
    'idle', cto_uuid,
    'pi_local',
    jsonb_build_object(
      'model', 'google/gemini-3.1-pro-preview',
      'thinking', 'high',
      'cwd', repo_coleta,
      'instructionsFilePath', drafts_root || '\DataEngineer\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 7500, '{}'::jsonb
  );

  -- BackendEngineer ---------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    backend_uuid, company_uuid,
    'BackendEngineer', 'backend_engineer', 'Backend Engineer (FastAPI + SQL)',
    'idle', cto_uuid,
    'codex_local',
    jsonb_build_object(
      'model', 'gpt-5.4',
      'modelReasoningEffort', 'medium',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\BackendEngineer\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'dangerouslyBypassApprovalsAndSandbox', false,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 7500, '{}'::jsonb
  );

  -- FrontendEngineer --------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    frontend_uuid, company_uuid,
    'FrontendEngineer', 'frontend_engineer', 'Frontend Engineer (React/TS)',
    'idle', cto_uuid,
    'codex_local',
    jsonb_build_object(
      'model', 'gpt-5.4',
      'modelReasoningEffort', 'medium',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\FrontendEngineer\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'dangerouslyBypassApprovalsAndSandbox', false,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 7500, '{}'::jsonb
  );

  -- DevOpsSRE ---------------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    devops_uuid, company_uuid,
    'DevOpsSRE', 'devops_sre', 'DevOps / SRE (Vercel + Supabase + observability)',
    'idle', cto_uuid,
    'codex_local',
    jsonb_build_object(
      'model', 'gpt-5.4',
      'modelReasoningEffort', 'medium',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\DevOpsSRE\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'dangerouslyBypassApprovalsAndSandbox', false,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 5000, '{}'::jsonb
  );

  -- SecurityAuditor specialist lane ----------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions
  ) VALUES (
    security_uuid, company_uuid,
    'SecurityAuditor', 'security_auditor', 'Security Auditor (RLS + data isolation)',
    'idle', cto_uuid,
    'pi_local',
    jsonb_build_object(
      'model', 'zai/glm-5.1',
      'thinking', 'high',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\SecurityAuditor\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 5000, '{}'::jsonb
  );

  -- BackendBurst ------------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions,
    pause_reason, paused_at
  ) VALUES (
    backend_burst_uuid, company_uuid,
    'BackendBurst', 'backend_burst', 'Backend Burst Worker',
    'paused', cto_uuid,
    'cursor',
    jsonb_build_object(
      'model', 'auto',
      'cwd', repo_ilm,
      'instructionsFilePath', drafts_root || '\BackendBurst\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 5000, '{}'::jsonb,
    'Activate after Cursor Agent CLI is available on the runtime host.', NOW()
  );

  -- FrontendBurst -----------------------------------------------------
  INSERT INTO agents (
    id, company_id, name, role, title, status,
    reports_to, adapter_type, adapter_config,
    runtime_config, budget_monthly_cents, permissions,
    pause_reason, paused_at
  ) VALUES (
    frontend_burst_uuid, company_uuid,
    'FrontendBurst', 'frontend_burst', 'Frontend Burst Worker',
    'paused', cto_uuid,
    'cursor',
    jsonb_build_object(
      'model', 'auto',
      'cwd', repo_lmm,
      'instructionsFilePath', drafts_root || '\FrontendBurst\AGENTS.md',
      'timeoutSec', 1800,
      'graceSec', 30,
      'workspaceStrategy', jsonb_build_object(
        'type', 'git_worktree',
        'worktreeParentDir', worktree_parent
      )
    ),
    '{}'::jsonb, 2500, '{}'::jsonb,
    'Activate after Cursor Agent CLI is available on the runtime host.', NOW()
  );

  INSERT INTO goals (
    id, company_id, title, description, level, status, owner_agent_id
  ) VALUES (
    goal_uuid, company_uuid,
    'Operacao continua ILM',
    'Manter ingestao 24/7, atendimento dos clientes ativos, evolucao da analytics platform e do CRM, e zero incidente de cross-artist data leakage.',
    'objective', 'active', ceo_uuid
  );

  INSERT INTO projects (
    id, company_id, goal_id, name, description, status,
    lead_agent_id, color, execution_workspace_policy
  ) VALUES
    (
      proj_analytics, company_uuid, goal_uuid,
      'analytics-platform',
      'Plataforma fullstack ILM: FastAPI + React SPA + migrations Supabase. Owner tecnico: Backend/Frontend, CTO arbitra cross-stack.',
      'active', backend_uuid, '#2563eb',
      jsonb_build_object(
        'repoRoot', repo_ilm,
        'worktreeParentDir', worktree_parent,
        'baseRef', 'main'
      )
    ),
    (
      proj_crm, company_uuid, goal_uuid,
      'crm-surface',
      'CRM e automacao comercial lovemoneymusic. Same backend/db do ILM.',
      'active', frontend_uuid, '#db2777',
      jsonb_build_object(
        'repoRoot', repo_lmm,
        'worktreeParentDir', worktree_parent,
        'baseRef', 'main'
      )
    ),
    (
      proj_ingestion, company_uuid, goal_uuid,
      'ingestion-engine',
      'Daemon ilm-coleta: coletor Spotify for Artists 24/7. Owner: DataEngineer.',
      'active', data_eng_uuid, '#16a34a',
      jsonb_build_object(
        'repoRoot', repo_coleta,
        'worktreeParentDir', worktree_parent,
        'baseRef', 'main'
      )
    );

  RAISE NOTICE 'Company ILM seeded: id=%', company_uuid;
  RAISE NOTICE 'Agents: CEO=% CTO=% Data=% Backend=% Frontend=% DevOps=% Security=% BackendBurst=% FrontendBurst=%',
    ceo_uuid, cto_uuid, data_eng_uuid, backend_uuid, frontend_uuid, devops_uuid, security_uuid, backend_burst_uuid, frontend_burst_uuid;
  RAISE NOTICE 'Goal: % | Projects: analytics=% crm=% ingestion=%',
    goal_uuid, proj_analytics, proj_crm, proj_ingestion;
END $$;

SELECT
  (SELECT id FROM companies WHERE name = 'ILM') AS company_id,
  (SELECT COUNT(*) FROM agents   WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')) AS agents,
  (SELECT COUNT(*) FROM goals    WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')) AS goals,
  (SELECT COUNT(*) FROM projects WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')) AS projects;

COMMIT;
