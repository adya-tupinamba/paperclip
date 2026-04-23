-- 0065_ilm_v2_lifecycle.sql
-- ILM-v2: task lifecycle state machine + handoff + audit.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'inbox',
  ADD COLUMN IF NOT EXISTS spec_md TEXT,
  ADD COLUMN IF NOT EXISTS plan_md TEXT,
  ADD COLUMN IF NOT EXISTS handoff_md TEXT,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS pr_url TEXT,
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

ALTER TABLE issues
  ADD CONSTRAINT chk_issue_retry_cap CHECK (retry_count <= 3),
  ADD CONSTRAINT chk_issue_blocked_has_reason
    CHECK (lifecycle_state != 'blocked' OR blocker_reason IS NOT NULL),
  ADD CONSTRAINT chk_issue_lifecycle_state CHECK (
    lifecycle_state IN (
      'inbox','spec_d','planned','implementing','review',
      'pr_open','merged','blocked','rejected','failed','changes_requested'
    )
  );

-- NOTE: plan referenced `assignee_id`, but the issues table uses `assignee_agent_id`
-- (see packages/db/src/schema/issues.ts). Using the real column for the lifecycle queue.
CREATE INDEX IF NOT EXISTS issues_lifecycle_idx
  ON issues(lifecycle_state, assignee_agent_id);

CREATE TABLE IF NOT EXISTS issue_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id UUID NOT NULL,
  -- NOTE: plan referenced `runs(id)`, but the schema has no bare `runs` table.
  -- `heartbeat_runs(id)` is the agent-run audit record.
  run_id UUID NULL REFERENCES heartbeat_runs(id),
  reason TEXT,
  handoff_md TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_transitions_issue_idx
  ON issue_transitions(issue_id, created_at DESC);

-- Enforce `merged` terminality via trigger.
CREATE OR REPLACE FUNCTION trg_issues_merged_terminal()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_state = 'merged' AND NEW.lifecycle_state <> 'merged' THEN
    RAISE EXCEPTION 'cannot transition out of merged (issue %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS issues_merged_terminal ON issues;
CREATE TRIGGER issues_merged_terminal
  BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION trg_issues_merged_terminal();
