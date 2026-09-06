-- Pausa global antes da migra��o gpt-5.4 + reestrutura��o CEO/CTO.
-- Aplicar com server parado OU rec�m subido (antes de qualquer heartbeat acontecer).
-- Conex�o: postgres://paperclip:paperclip@127.0.0.1:54329/paperclip (embedded-postgres default)

BEGIN;

-- 1. Snapshot do estado atual (apenas leitura, imprime na sa�da)
\echo '=== COMPANIES ANTES DA PAUSA ==='
SELECT id, name, status, budget_monthly_cents, spent_monthly_cents
FROM companies
ORDER BY name;

\echo '=== AGENTS ATIVOS POR COMPANY ==='
SELECT c.name AS company, COUNT(a.id) AS agents, SUM(CASE WHEN a.status != 'paused' THEN 1 ELSE 0 END) AS active
FROM companies c
LEFT JOIN agents a ON a.company_id = c.id
GROUP BY c.name
ORDER BY c.name;

\echo '=== ISSUES EM ANDAMENTO ==='
SELECT status, COUNT(*) FROM issues
WHERE status IN ('todo','in_progress','in_review','blocked')
GROUP BY status
ORDER BY status;

-- 2. Pausa fina

UPDATE companies
SET status = 'paused',
    pause_reason = 'migration to gpt-5.4 + CEO/CTO restructure',
    paused_at = NOW(),
    updated_at = NOW()
WHERE status != 'paused';

UPDATE agents
SET status = 'paused',
    pause_reason = 'migration to gpt-5.4 + CEO/CTO restructure',
    paused_at = NOW(),
    updated_at = NOW()
WHERE status != 'paused';

UPDATE routines
SET status = 'paused',
    updated_at = NOW()
WHERE status = 'active';

UPDATE routine_triggers
SET enabled = FALSE,
    updated_at = NOW()
WHERE enabled = TRUE;

-- 3. Cancela work in-flight pra n�o retomar no primeiro heartbeat
UPDATE issues
SET status = 'cancelled',
    updated_at = NOW()
WHERE status IN ('todo','in_progress','in_review');

\echo '=== RESULTADO DA PAUSA ==='
SELECT
  (SELECT COUNT(*) FROM companies WHERE status = 'paused') AS companies_paused,
  (SELECT COUNT(*) FROM agents WHERE status = 'paused') AS agents_paused,
  (SELECT COUNT(*) FROM routines WHERE status = 'paused') AS routines_paused,
  (SELECT COUNT(*) FROM routine_triggers WHERE enabled = FALSE) AS triggers_disabled,
  (SELECT COUNT(*) FROM issues WHERE status = 'cancelled') AS issues_cancelled;

COMMIT;
