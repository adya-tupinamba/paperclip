-- Seed ILM initial backlog (15 issues).
--
-- Requer que scripts/seed-ilm-company.sql ja tenha rodado (company ILM + 7 agentes + goal + 3 projects).
-- Aplica em uma transacao as 15 issues iniciais, resolvendo UUIDs por nome (companies.name='ILM',
-- agents.name=..., projects.name=...). Identifier gerado sequencialmente (ILM-1..ILM-15) e
-- companies.issue_counter atualizado no final.
--
-- Ordem de ataque recomendada (marcadas priority='high'):
--   ILM-1  Mapear estado real do coletor
--   ILM-6  Auditar auth e RLS
--   ILM-7  Mapear endpoints e queries dos dashboards
--   ILM-12 Mapear estado real do CRM
--   ILM-11 Smoke test ponta a ponta de 1 artista
--
-- APPLY:
--   psql "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip" -f scripts/seed-ilm-backlog.sql
-- Ou via tsx:
--   pnpm exec tsx -e "import postgres from 'postgres'; import fs from 'node:fs'; const sql=postgres('postgres://paperclip:paperclip@127.0.0.1:54329/paperclip'); await sql.unsafe(fs.readFileSync('scripts/seed-ilm-backlog.sql','utf8')); await sql.end();"
--
-- REVERT:
--   DELETE FROM issues WHERE company_id=(SELECT id FROM companies WHERE name='ILM')
--     AND identifier LIKE 'ILM-%' AND issue_number BETWEEN 1 AND 15;
--   UPDATE companies SET issue_counter=0 WHERE name='ILM';

BEGIN;

DO $$
DECLARE
  company_uuid     uuid;
  goal_uuid        uuid;
  ceo_uuid         uuid;
  cto_uuid         uuid;
  data_eng_uuid    uuid;
  backend_uuid     uuid;
  frontend_uuid    uuid;
  devops_uuid      uuid;
  security_uuid    uuid;
  proj_analytics   uuid;
  proj_crm         uuid;
  proj_ingestion   uuid;
  n int := 0;
BEGIN
  -- Resolve IDs por nome
  SELECT id INTO company_uuid FROM companies WHERE name = 'ILM';
  IF company_uuid IS NULL THEN
    RAISE EXCEPTION 'Company ILM not found. Run scripts/seed-ilm-company.sql first.';
  END IF;

  SELECT id INTO goal_uuid       FROM goals    WHERE company_id = company_uuid AND title = 'Operacao continua ILM';
  SELECT id INTO ceo_uuid        FROM agents   WHERE company_id = company_uuid AND name = 'CEO';
  SELECT id INTO cto_uuid        FROM agents   WHERE company_id = company_uuid AND name = 'CTO';
  SELECT id INTO data_eng_uuid   FROM agents   WHERE company_id = company_uuid AND name = 'DataEngineer';
  SELECT id INTO backend_uuid    FROM agents   WHERE company_id = company_uuid AND name = 'BackendEngineer';
  SELECT id INTO frontend_uuid   FROM agents   WHERE company_id = company_uuid AND name = 'FrontendEngineer';
  SELECT id INTO devops_uuid     FROM agents   WHERE company_id = company_uuid AND name = 'DevOpsSRE';
  SELECT id INTO security_uuid   FROM agents   WHERE company_id = company_uuid AND name = 'SecurityAuditor';
  SELECT id INTO proj_analytics  FROM projects WHERE company_id = company_uuid AND name = 'analytics-platform';
  SELECT id INTO proj_crm        FROM projects WHERE company_id = company_uuid AND name = 'crm-surface';
  SELECT id INTO proj_ingestion  FROM projects WHERE company_id = company_uuid AND name = 'ingestion-engine';

  IF data_eng_uuid IS NULL OR backend_uuid IS NULL OR frontend_uuid IS NULL
     OR devops_uuid IS NULL OR security_uuid IS NULL OR cto_uuid IS NULL
     OR proj_analytics IS NULL OR proj_crm IS NULL OR proj_ingestion IS NULL THEN
    RAISE EXCEPTION 'Missing agents or projects. Check seed-ilm-company.sql ran cleanly.';
  END IF;

  SELECT issue_counter INTO n FROM companies WHERE id = company_uuid;

  ------------------------------------------------------------------
  -- BLOCO A: Ingestion Engine (ilm-coleta)
  ------------------------------------------------------------------

  -- ILM-1
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_ingestion, goal_uuid,
    'Mapear estado real do coletor em producao',
E'## Why this matters

O coletor Spotify for Artists e a base de toda a plataforma analytics da ILM. Nao da para priorizar fix/feature sem ter um retrato honesto do que roda hoje, o que quebra com que frequencia, quais contas SFA estao em uso e onde estao os pontos cegos. Este mapeamento alimenta as 4 issues seguintes do bloco Ingestion.

## Acceptance criteria

- Listar cada capability (streams, source-of-streams, playlists, audience, catalog) com frequencia de execucao real e taxa de sucesso observada nas ultimas 2 semanas.
- Listar as 4 contas SFA (Chrome profiles) em uso com quais artistas cada uma cobre.
- Identificar pontos cegos: artistas sem coleta, capabilities desativadas, gaps de data ranges.
- Comentario/resumo com os 5 riscos top ranqueados.

## Handoff target

CTO (para decidir ordem de correcao em funcao do impacto cross-stack).

## Timebox

1 dia.',
    'todo', 'high', data_eng_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-2
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_ingestion, goal_uuid,
    'Blindar refresh de token sem vazamento',
E'## Why this matters

Bearer tokens do Spotify for Artists sao extraidos via pymem do chrome.exe e rotacionam a cada ~2h. Um vazamento em log/stdout/arquivo expoe acesso a dados privados de varios artistas simultaneamente. Este e um vetor P0 de vazamento cross-artist.

## Acceptance criteria

- Revisar todo o fluxo de extracao/refresh/uso de bearer (ilm-coleta).
- Garantir que nenhum bearer aparece em: stdout, log files, exceptions, Supabase rows em texto puro, traces de erro.
- Adicionar assertion em teste (fixture) que bloqueia regressao.
- Checklist de rotacao (quando, como, evidencia) documentado em README do ilm-coleta.

## Handoff target

SecurityAuditor (para auditar o fluxo completo contra padroes de leakage).

## Timebox

2 dias.',
    'todo', 'high', data_eng_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-3
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_ingestion, goal_uuid,
    'Criar health snapshot confiavel da coleta',
E'## Why this matters

Hoje nao ha uma forma rapida e confiavel de saber se a coleta esta saudavel. CTO e DevOps precisam de um snapshot que responda em segundos: ultimo ciclo, falhas recentes, artistas com gap, status por capability.

## Acceptance criteria

- Comando (ex: `ilm-coleta health --snapshot`) ou relatorio Supabase que mostre:
  - timestamp do ultimo ciclo completo
  - lista de falhas nas ultimas 24h (com razao agrupada)
  - artistas com gap de dados > 24h
  - status OK/degraded/broken por capability
- Output formatado para leitura rapida (nao JSON gigante).
- Documentar como rodar no README do ilm-coleta.

## Handoff target

DevOpsSRE (para integrar o snapshot ao fluxo Sentry->Linear->Slack e definir alertas).

## Timebox

1-2 dias.',
    'todo', 'medium', data_eng_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-4
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_ingestion, goal_uuid,
    'Garantir idempotencia e backfill seguro',
E'## Why this matters

A coleta e delta-only, mas rodas repetidas ou backfills parciais podem duplicar linhas em tabelas de streams/playlists/audience se as chaves de UPSERT nao estiverem bem definidas. Duplicidade nos relatorios corroe confianca do artista no dashboard.

## Acceptance criteria

- Documentar em markdown (README do ilm-coleta ou doc/) a chave de UPSERT por tabela critica: track_streams_history, daily_sources, track_playlists, audience_segments, tracks.
- Definir regra explicita: quando rodar delta vs backfill, quando e seguro refazer ranges.
- Validar executando 2x o mesmo ciclo num artista teste - zero duplicata.
- Se houver tabela com UPSERT fraca ou ausente, abrir subissue para BackendEngineer ajustar migration.

## Handoff target

BackendEngineer (para absorver mudancas de schema/constraint se necessario).

## Timebox

2 dias.',
    'todo', 'medium', data_eng_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-5
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_ingestion, goal_uuid,
    'Detectar drift de formato da Spotify antes de quebrar geral',
E'## Why this matters

Spotify for Artists mudou o formato de source-of-streams em 2026 (array -> flat). Essa classe de mudanca volta a acontecer. Precisamos de smoke checks com fixtures reais que falhem ruidosamente antes da producao engolir dado lixo ou perder coleta silenciosamente.

## Acceptance criteria

- Identificar os 3 pontos de parsing mais fragveis (provavel: streams timeseries, SOS flat/array, playlists followers).
- Criar fixtures minimas com payload real capturado de cada endpoint.
- Smoke checks (pytest ou script standalone) que rodam contra as fixtures e validam shape esperado.
- Se algum parser ja estiver quebrado, abrir subissue imediata com repro.

## Handoff target

CTO (para classificar severidade dos parsers quebrados e despachar fix).

## Timebox

2 dias.',
    'todo', 'medium', data_eng_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  ------------------------------------------------------------------
  -- BLOCO B: Analytics Platform (ilm)
  ------------------------------------------------------------------

  -- ILM-6
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Auditar auth e RLS das superficies criticas',
E'## Why this matters

Vazamento de dados entre artistas mata o negocio (R$2k x 9 clientes = churn imediato + reputacao). Antes de construir mais em cima da plataforma analytics, precisamos saber onde estao os buracos reais de RLS, auth e isolamento por artista.

## Acceptance criteria

- Mapear tabelas com risco de cross-artist leakage: track_streams_history, tracks, collection_queue, leads, email_log, reports, etc.
- Listar endpoints FastAPI que consultam essas tabelas e o caminho de auth/RLS aplicado (ou ausente).
- Testar impersonacao real: com role=artist de cliente A, tentar ver dado de cliente B.
- Listar bloqueadores P0/P1 com ordem de correcao recomendada.
- Se achar caso confirmado de leakage, escalar P0 direto para CEO (bypass CTO).

## Handoff target

BackendEngineer (para aplicar fixes nas RLS policies e middleware).

## Timebox

2 dias.',
    'todo', 'high', security_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-7
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Mapear endpoints e queries que alimentam os dashboards principais',
E'## Why this matters

A plataforma tem 58 routers FastAPI e varias telas de dashboard, mas nem tudo esta em uso real. Precisamos de clareza sobre quais endpoints sustentam as telas que clientes realmente abrem, onde estao as queries lentas/fragveis e qual o top 3 de correcoes de maior impacto.

## Acceptance criteria

- Mapear os endpoints efetivamente chamados pelas 3-5 telas principais do dashboard.
- Para cada endpoint: query SQL underlying, tempo medio, dependencia de tabela de coleta.
- Identificar queries com cross-join ou N+1 obvios e marcar prioridade.
- Top 3 correcoes: endpoint, problema, solucao proposta, impacto estimado.

## Handoff target

FrontendEngineer (para validar se as telas realmente usam o que foi mapeado e apontar desvios).

## Timebox

2 dias.',
    'todo', 'high', backend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-8
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Estabilizar dashboard minimo para 1 artista',
E'## Why this matters

Antes de investir em features novas, o dashboard precisa funcionar de forma confiavel para 1 artista real (ex: Mari Fernandez). Loading states, error states, mobile basico - o ciclo de confianca do cliente comeca aqui.

## Acceptance criteria

- Escolher 1 artista real (combinar com CEO).
- Garantir que a superficie minima (streams, top tracks, audience summary) renderiza sem erro.
- Loading states (skeleton) e error states (retry) aceitaveis.
- Nao quebra em mobile basico (iPhone/Android viewport comum).
- Lighthouse spot-check aceitavel (LCP/CLS sem regressao grave).

## Handoff target

BackendEngineer (se algum endpoint quebrar ou precisar ajuste de shape durante a estabilizacao).

## Timebox

3 dias.',
    'todo', 'medium', frontend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-9
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Corrigir a integracao entre coleta e consumo no produto',
E'## Why this matters

Dado coletado mas nao visivel na UI (ou vice-versa) e o caso mais comum de frustracao do cliente. Precisamos escolher 1 fluxo critico quebrado/fragvel e costurar coleta -> banco -> endpoint -> transform -> UI ate o dado aparecer corretamente.

## Acceptance criteria

- Escolher 1 fluxo (ex: streams por track, source breakdown, playlist ranking).
- Validar cada camada: coleta inserindo certo, tabela com dado, endpoint retornando shape esperado, frontend consumindo.
- Corrigir onde quebra.
- Deixar evidencia de validacao (screenshot, curl output, assertions de teste).

## Handoff target

FrontendEngineer (para garantir que o fluxo chega ate a tela com o comportamento correto).

## Timebox

2-3 dias.',
    'todo', 'medium', backend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-10
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Adicionar indicador de frescor dos dados',
E'## Why this matters

Cliente olhando numero velho sem saber que esta velho perde confianca na plataforma. Cada dashboard precisa de um indicador claro de "atualizado em ..." baseado no last successful collection.

## Acceptance criteria

- Backend expoe endpoint (ou campo em endpoint existente) com last_successful_collection_at por artista ou dataset.
- Sem inventar dado inexistente: se a coleta falhou, indicador mostra quando foi a ultima ok, nao hoje.
- Frontend renderiza "Atualizado em DD/MM HH:mm" em pelo menos 2 superficies principais.
- Comportamento definido para gap > 24h (destaque visual ou warning).

## Handoff target

FrontendEngineer (para integrar o indicador nas superficies).

## Timebox

1-2 dias.',
    'todo', 'medium', backend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-11
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_analytics, goal_uuid,
    'Criar smoke test operacional de 1 artista ponta a ponta',
E'## Why this matters

Sem um smoke test ponta a ponta, regressoes em qualquer camada (coleta, banco, API, UI) so aparecem pelo cliente. Um roteiro verificavel reduz isso para minutos.

## Acceptance criteria

- Roteiro documentado (doc/ ou runbook) que cobre: coleta do artista X roda -> tabela recebe linhas novas -> endpoint retorna as linhas -> tela renderiza o numero esperado.
- Passo-a-passo com comandos concretos (curl, SQL, URL).
- Identificar onde o fluxo quebra hoje (se quebrar).
- Gerar 2 ou 3 subissues concretas para cada ponto quebrado.

## Handoff target

DataEngineer (se quebrar na coleta) ou BackendEngineer (se quebrar no consumo).

## Timebox

1-2 dias.',
    'todo', 'high', cto_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  ------------------------------------------------------------------
  -- BLOCO C: CRM Surface (lovemoneymusic)
  ------------------------------------------------------------------

  -- ILM-12
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_crm, goal_uuid,
    'Mapear estado real do CRM e cortar escopo para MVP operacional',
E'## Why this matters

O lovemoneymusic tem 40+ paginas no frontend e 9 routers no backend, mas nao esta claro o que e essencial para o fluxo comercial real da ILM (leads -> proposta -> contrato). Sem esse corte, continuamos construindo em cima de codigo morto.

## Acceptance criteria

- Listar todas as paginas/rotas e classificar: em uso, dormindo, candidato a remover.
- Listar as 9 routers FastAPI (crm, ai_sales, intelligence, alerts, knowledge, glm_chat, agents, campaigns, financial) com status de uso real.
- Definir MVP comercial minimo: quais 3-5 telas sustentam "eu consigo trabalhar um lead ate virar cliente".
- Lista do que pode ser arquivado sem impacto.

## Handoff target

FrontendEngineer (para implementar o corte e cuidar das telas MVP).

## Timebox

2 dias.',
    'todo', 'high', cto_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-13
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_crm, goal_uuid,
    'Auditar modelo de dados de leads, artistas e relacionamento comercial',
E'## Why this matters

CRM compartilha Supabase com analytics. Schema ruim aqui vaza para la. Precisamos ter certeza que leads/contatos/propostas estao modelados sem duplicidade com tabelas de artista e sem acoplamento que complique isolamento de dados.

## Acceptance criteria

- Mapear as entidades principais: lead, contact, proposal, pipeline_stage, interaction, campaign.
- Identificar campos faltando, duplicidade com tabelas de artist/user_artists, risco de acoplamento.
- Sugerir ajuste minimo de schema (migration) quando necessario - nao refactor.
- Nao tocar em auth.users nem em user_artists sem alinhar com SecurityAuditor.

## Handoff target

SecurityAuditor (para validar que o modelo proposto respeita isolamento e RLS).

## Timebox

2 dias.',
    'todo', 'medium', backend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-14
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_crm, goal_uuid,
    'Entregar pipeline comercial minimo utilizavel',
E'## Why this matters

Depois do corte de escopo (ILM-12) e auditoria de schema (ILM-13), entregar o pipeline funcional. Foco em "consigo trabalhar um lead de ponta a ponta" - sem polish excessivo.

## Acceptance criteria

- Visao minima de pipeline/etapas (kanban simples ou lista por stage).
- Detalhe de lead com os campos essenciais (nome, artista, stage, ultima interacao, notas).
- Navegacao funcional: entra, cria, move stage, comenta, volta.
- Nao precisa ser bonito - precisa funcionar.
- Smoke: 1 lead novo criado, movido 2 stages, marcado com resultado.

## Handoff target

BackendEngineer (se faltar endpoint ou shape durante a implementacao).

## Timebox

3 dias.',
    'todo', 'medium', frontend_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- ILM-15
  n := n + 1;
  INSERT INTO issues (company_id, project_id, goal_id, title, description, status, priority,
                      assignee_agent_id, created_by_agent_id, issue_number, identifier, origin_kind)
  VALUES (company_uuid, proj_crm, goal_uuid,
    'Criar trilha minima de auditoria e seguranca no CRM',
E'## Why this matters

CRM guarda conversa com cliente, propostas e valores. Sem trilha de auditoria, acao sensivel nao deixa rastro e exposicao indevida passa invisivel. Essencial para operacao responsavel.

## Acceptance criteria

- Revisar permissoes por role no CRM (admin, agency, artist, viewer).
- Identificar endpoints que expoem dados sensiveis sem checagem adequada.
- Garantir log de acoes criticas: criar/editar proposta, mover lead, exportar dado.
- Apontar qualquer vazamento ou ausencia de trilha como bloqueador.
- Se encontrar P0, escalar direto ao CEO (bypass CTO).

## Handoff target

CTO (para priorizar correcoes P1/P2 e despachar fix via BackendEngineer).

## Timebox

2 dias.',
    'todo', 'medium', security_uuid, ceo_uuid, n, 'ILM-' || n, 'manual');

  -- Atualiza contador da company
  UPDATE companies
    SET issue_counter = n, updated_at = NOW()
    WHERE id = company_uuid;

  RAISE NOTICE 'Seeded % issues (ILM-1..ILM-%) for company %', n, n, company_uuid;
END $$;

-- Confirma visualmente
SELECT identifier, priority, status,
       (SELECT name FROM agents a WHERE a.id = i.assignee_agent_id) AS assignee,
       (SELECT name FROM projects p WHERE p.id = i.project_id) AS project,
       title
  FROM issues i
  WHERE company_id = (SELECT id FROM companies WHERE name = 'ILM')
  ORDER BY issue_number;

COMMIT;
