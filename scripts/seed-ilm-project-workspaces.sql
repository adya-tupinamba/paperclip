-- Seed project_workspaces for ILM company.
--
-- These rows tell Paperclip where each project lives LOCALLY on the host filesystem.
-- Without them, agent heartbeats with workspaceStrategy=git_worktree fall back to
-- ~/.paperclip/.../agents/<id>/ which is not a git repo, and fail with:
--   fatal: not a git repository (or any of the parent directories): .git
--
-- APPLY (after scripts/seed-ilm-company.sql):
--   pnpm --filter @paperclipai/db exec tsx -e "import postgres from 'postgres'; import fs from 'node:fs'; const sql=postgres('postgres://paperclip:paperclip@127.0.0.1:54329/paperclip'); await sql.unsafe(fs.readFileSync('../../scripts/seed-ilm-project-workspaces.sql','utf8')); await sql.end();"
--
-- REVERT:
--   DELETE FROM project_workspaces WHERE company_id = (SELECT id FROM companies WHERE name='ILM');

BEGIN;

DO $$
DECLARE
  company_uuid uuid;
  proj_analytics uuid;
  proj_crm uuid;
  proj_ingestion uuid;
BEGIN
  SELECT id INTO company_uuid FROM companies WHERE name = 'ILM';
  IF company_uuid IS NULL THEN
    RAISE EXCEPTION 'Company ILM not found. Run seed-ilm-company.sql first.';
  END IF;

  SELECT id INTO proj_analytics FROM projects WHERE company_id = company_uuid AND name = 'analytics-platform';
  SELECT id INTO proj_crm        FROM projects WHERE company_id = company_uuid AND name = 'crm-surface';
  SELECT id INTO proj_ingestion  FROM projects WHERE company_id = company_uuid AND name = 'ingestion-engine';

  IF proj_analytics IS NULL OR proj_crm IS NULL OR proj_ingestion IS NULL THEN
    RAISE EXCEPTION 'Missing one or more ILM projects. Run seed-ilm-company.sql first.';
  END IF;

  -- analytics-platform -> C:\Users\ilm\Documents\GitHub\ilm (git repo)
  INSERT INTO project_workspaces (
    company_id, project_id, name, source_type, cwd, default_ref, visibility, is_primary
  ) VALUES (
    company_uuid, proj_analytics,
    'ilm-local', 'local_path',
    'C:\Users\ilm\Documents\GitHub\ilm',
    'main', 'default', true
  );

  -- crm-surface -> C:\Users\ilm\Documents\GitHub\lovemoneymusic (git repo)
  INSERT INTO project_workspaces (
    company_id, project_id, name, source_type, cwd, default_ref, visibility, is_primary
  ) VALUES (
    company_uuid, proj_crm,
    'lovemoneymusic-local', 'local_path',
    'C:\Users\ilm\Documents\GitHub\lovemoneymusic',
    'main', 'default', true
  );

  -- ingestion-engine -> C:\Users\ilm\Documents\GitHub\ilm-coleta (git repo)
  INSERT INTO project_workspaces (
    company_id, project_id, name, source_type, cwd, default_ref, visibility, is_primary
  ) VALUES (
    company_uuid, proj_ingestion,
    'ilm-coleta-local', 'local_path',
    'C:\Users\ilm\Documents\GitHub\ilm-coleta',
    'main', 'default', true
  );

  RAISE NOTICE 'Seeded 3 project_workspaces for company ILM';
END $$;

SELECT p.name AS project, pw.name AS workspace, pw.cwd, pw.default_ref, pw.is_primary
  FROM project_workspaces pw
  JOIN projects p ON p.id = pw.project_id
  WHERE pw.company_id = (SELECT id FROM companies WHERE name='ILM')
  ORDER BY p.name;

COMMIT;
