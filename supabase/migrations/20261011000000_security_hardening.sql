-- =============================================================================
-- Hardening de segurança do banco (2026-10-11)
-- =============================================================================
--
-- O que esta migration faz:
--
-- 1. Fecha a leitura anônima. O init criava policies `FOR SELECT TO anon USING (true)`
--    em campaigns, contacts, templates, flows, inbox_conversations, inbox_messages e
--    account_alerts. Como a chave publishable (role anon) vai no bundle do browser,
--    qualquer pessoa conseguia GET /rest/v1/contacts ou /rest/v1/inbox_messages.
--    Aqui as policies são removidas e anon/authenticated perdem TODO privilégio em
--    TODAS as tabelas/views/sequences de public (inventário dinâmico, não lista manual).
--    O app não usa Supabase Auth: todo acesso legítimo é service role no servidor
--    (rotas de API, server actions e lib/supabase-server.ts), com a autorização
--    feita pelo proxy.ts (sessão do dashboard, API key, cron, atendente).
--
-- 2. Fecha as RPCs. Funções SECURITY DEFINER das migrations 2026* (claim_campaign_batch,
--    reap_stuck_campaign_sending, try_lock_campaign_dispatch, release_campaign_dispatch_lock,
--    dispara_cron_tick, increment_campaign_auto_reply_counters...) ficaram executáveis
--    por anon via /rest/v1/rpc/*. Aqui EXECUTE é revogado de PUBLIC/anon/authenticated
--    em TODAS as funções de public (e nas futuras via default privileges); só
--    service_role mantém EXECUTE. SECURITY DEFINER sem search_path fixo ganha um.
--
-- 3. Realtime via Broadcast from Database. O realtime do dashboard usava
--    postgres_changes com a chave anon, que dependia exatamente das policies acima.
--    Agora uma trigger (dispara_broadcast_change) publica no canal público
--    'dispara-db' (evento 'db_change') um payload com SÓ colunas não sensíveis
--    (ids, status, contadores, timestamps). NUNCA inclua PII (nome, telefone, email,
--    conteúdo de mensagem, custom_fields): quem tem a chave publishable pode ouvir
--    (e também emitir) mensagens nesse canal. O frontend trata o evento como um
--    "sinal de invalidação" e busca os dados reais pelas APIs autenticadas.
--    Cada evento vira 1 linha em realtime.messages (o Realtime só apaga a partição
--    diária dias depois), então o volume é controlado aqui:
--    - campaign_contacts NÃO tem trigger (volume do disparo em massa; o progresso vem
--      de campaigns + lib/realtime-broadcast-server.ts);
--    - campaigns: INSERT/DELETE sempre; UPDATE só quando muda status/conclusão/
--      cancelamento/pasta, ou contadores no máximo 1x a cada 2s por campanha
--      (increment_campaign_stat faz 1 UPDATE por delivered/read/failed). UPDATE que só
--      mexe em dispatch_lock_* não publica;
--    - contacts usa trigger por STATEMENT (um evento por import/bulk update);
--    - inbox_messages publica DELETE por STATEMENT (apagar uma conversa apaga N
--      mensagens em cascata) e flow_submissions só INSERT (o frontend só usa isso;
--      o SET NULL em massa de bulk_delete_contacts não gera eventos).
--    O payload é montado com colunas explícitas (NEW.col), nunca com to_jsonb(NEW): não
--    destoasta template_snapshot, components, content, response_json etc. a cada escrita.
--    As tabelas saem da publicação supabase_realtime (postgres_changes não é mais usado).
--
-- EXIGE a versão correspondente do frontend (realtime via broadcast em
-- lib/supabase-realtime.ts + CentralizedRealtimeProvider, useUnreadCount via
-- /api/inbox/unread-count e lib/supabase-server.ts com service role). Com o frontend
-- antigo o realtime do dashboard para de atualizar (as listas seguem funcionando
-- por polling/refetch), e as leituras diretas do browser passam a falhar.
--
-- Idempotente e SEGURO DE RE-EXECUTAR: pode rodar mais de uma vez (o installer aplica
-- todas as migrations em ordem em instalações novas; em produção é aplicada
-- manualmente). Re-executar recria função e triggers com a definição deste arquivo.
--
-- COMO APLICAR EM PRODUÇÃO (operacional):
-- - Rode numa janela de BAIXO TRÁFEGO, fora de um disparo de campanha: ALTER TABLE e
--   DROP/CREATE TRIGGER pegam lock exclusivo nas tabelas e só soltam no COMMIT.
-- - Antes, confira no pg_stat_activity se há transação longa ou 'idle in transaction'
--   (ex.: export, ANALYZE manual, aba esquecida no SQL editor) e encerre-a.
-- - Aplique como UMA transação (SQL editor do Supabase, o installer, ou
--   `psql --single-transaction -f`). O `SET LOCAL lock_timeout` abaixo limita a espera
--   por lock a 5s: se estourar, a transação inteira faz rollback (nada fica pela
--   metade) e basta aplicar de novo. Fora de uma transação o SET LOCAL só avisa.
--
-- Rollback (emergência): recriar as policies anon_select_* e o GRANT SELECT nessas
-- 7 tabelas reabre o vazamento — prefira voltar o frontend e manter este arquivo.
-- =============================================================================

-- Nunca esperar indefinidamente por lock (nem segurar os já obtidos enquanto isso):
-- com tráfego, um ALTER TABLE na fila bloqueia até os SELECTs de quem chega depois.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- -----------------------------------------------------------------------------
-- 1) Policies de leitura anônima
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "anon_select_campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "anon_select_contacts" ON public.contacts;
DROP POLICY IF EXISTS "anon_select_templates" ON public.templates;
DROP POLICY IF EXISTS "anon_select_flows" ON public.flows;
DROP POLICY IF EXISTS "anon_select_inbox_conversations" ON public.inbox_conversations;
DROP POLICY IF EXISTS "anon_select_inbox_messages" ON public.inbox_messages;
DROP POLICY IF EXISTS "anon_select_account_alerts" ON public.account_alerts;

REVOKE ALL ON TABLE public.campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.contacts FROM anon, authenticated;
REVOKE ALL ON TABLE public.templates FROM anon, authenticated;
REVOKE ALL ON TABLE public.flows FROM anon, authenticated;
REVOKE ALL ON TABLE public.inbox_conversations FROM anon, authenticated;
REVOKE ALL ON TABLE public.inbox_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_alerts FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2) Inventário dinâmico: nenhuma tabela/view/sequence de public para anon/authenticated
--    + RLS ligado em todas as tabelas (defesa em profundidade: sem policy, nega).
--    service_role tem BYPASSRLS e segue com os grants que já tinha.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relkind, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      -- objetos de extensão instalada em public não são nossos
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', r.relname);

    -- ENABLE ROW LEVEL SECURITY pede ACCESS EXCLUSIVE mesmo quando o RLS já está ligado:
    -- só roda nas tabelas que ainda não têm (as do init já têm).
    IF r.relkind IN ('r', 'p') AND NOT r.relrowsecurity THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'security_hardening: não foi possível ligar RLS em public.% (%)', r.relname, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Objetos futuros criados pelo role que roda as migrations (postgres no Supabase).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3) SECURITY DEFINER sem search_path fixo (ex.: increment_campaign_auto_reply_counters)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.signature);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'security_hardening: não foi possível fixar search_path em % (%)', r.signature, SQLERRM;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 4) Realtime: Broadcast from Database (canal público 'dispara-db', evento 'db_change')
-- -----------------------------------------------------------------------------
-- Payload: { table, eventType, new, old, commit_timestamp }
--   new = colunas whitelisted da linha nova (INSERT/UPDATE), senão null
--   old = só as chaves da linha antiga (UPDATE/DELETE): id + coluna de filtro/transição
--         que o frontend usa (conversation_id, project_id, campaign_id, status...)
--   Trigger por STATEMENT (contacts, DELETE de inbox_messages): new = old = null.
-- As projeções abaixo (uma por tabela, com NEW.col/OLD.col explícitos) são a ÚNICA
-- fonte das colunas que saem do banco por este canal. Nunca use to_jsonb(NEW): ele
-- destoasta a linha inteira (template_snapshot, components, content...) a cada escrita.
-- Ao adicionar coluna: só ids, status, contadores e timestamps. Nada de PII.
CREATE OR REPLACE FUNCTION public.dispara_broadcast_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new jsonb := NULL;
  v_old jsonb := NULL;
BEGIN
  -- Fora do bloco de exceção: sem realtime.send não abre subtransação nenhuma.
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

  -- UM único bloco de exceção por chamada (cada bloco EXCEPTION abre uma subtransação,
  -- e realtime.send já abre outra por dentro). Ele cobre a projeção E o envio: realtime
  -- é best-effort e nunca pode derrubar a escrita no banco (ex.: coluna renomeada).
  BEGIN
    IF TG_LEVEL = 'ROW' THEN
      IF TG_TABLE_NAME = 'campaigns' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'status', NEW.status,
            'total_recipients', NEW.total_recipients,
            'sent', NEW.sent,
            'delivered', NEW.delivered,
            'read', NEW.read,
            'failed', NEW.failed,
            'skipped', NEW.skipped,
            'auto_reply_sent_count', NEW.auto_reply_sent_count,
            'quick_reply_match_count', NEW.quick_reply_match_count,
            'fallback_sent_count', NEW.fallback_sent_count,
            'folder_id', NEW.folder_id,
            'flow_id', NEW.flow_id,
            'ab_test_enabled', NEW.ab_test_enabled,
            'scheduled_date', NEW.scheduled_date,
            'started_at', NEW.started_at,
            'first_dispatch_at', NEW.first_dispatch_at,
            'last_sent_at', NEW.last_sent_at,
            'completed_at', NEW.completed_at,
            'cancelled_at', NEW.cancelled_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          -- status/completed_at antigos: useRealtimeNotifications detecta a TRANSIÇÃO
          -- para Concluído/Falhou (sem eles, todo update de contador viraria toast).
          v_old := jsonb_build_object(
            'id', OLD.id,
            'status', OLD.status,
            'completed_at', OLD.completed_at
          );
        END IF;

      ELSIF TG_TABLE_NAME = 'templates' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'status', NEW.status,
            'category', NEW.category,
            'language', NEW.language,
            'parameter_format', NEW.parameter_format,
            'fetched_at', NEW.fetched_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id);
        END IF;

      ELSIF TG_TABLE_NAME = 'flows' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'status', NEW.status,
            'meta_status', NEW.meta_status,
            'meta_flow_id', NEW.meta_flow_id,
            'meta_last_checked_at', NEW.meta_last_checked_at,
            'meta_published_at', NEW.meta_published_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id);
        END IF;

      ELSIF TG_TABLE_NAME = 'inbox_conversations' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'contact_id', NEW.contact_id,
            'ai_agent_id', NEW.ai_agent_id,
            'status', NEW.status,
            'mode', NEW.mode,
            'priority', NEW.priority,
            'unread_count', NEW.unread_count,
            'total_messages', NEW.total_messages,
            'last_message_at', NEW.last_message_at,
            'automation_paused_until', NEW.automation_paused_until,
            'human_mode_expires_at', NEW.human_mode_expires_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id);
        END IF;

      ELSIF TG_TABLE_NAME = 'inbox_messages' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'conversation_id', NEW.conversation_id,
            'direction', NEW.direction,
            'message_type', NEW.message_type,
            'source_type', NEW.source_type,
            'delivery_status', NEW.delivery_status,
            'created_at', NEW.created_at,
            'delivered_at', NEW.delivered_at,
            'read_at', NEW.read_at,
            'failed_at', NEW.failed_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id, 'conversation_id', OLD.conversation_id);
        END IF;

      ELSIF TG_TABLE_NAME = 'account_alerts' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'type', NEW.type,
            'code', NEW.code,
            'dismissed', NEW.dismissed,
            'created_at', NEW.created_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id);
        END IF;

      ELSIF TG_TABLE_NAME = 'template_projects' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'status', NEW.status,
            'template_count', NEW.template_count,
            'approved_count', NEW.approved_count,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id);
        END IF;

      ELSIF TG_TABLE_NAME = 'template_project_items' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'project_id', NEW.project_id,
            'status', NEW.status,
            'meta_status', NEW.meta_status,
            'category', NEW.category,
            'language', NEW.language,
            'submitted_at', NEW.submitted_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id, 'project_id', OLD.project_id);
        END IF;

      ELSIF TG_TABLE_NAME = 'flow_submissions' THEN
        IF TG_OP <> 'DELETE' THEN
          v_new := jsonb_build_object(
            'id', NEW.id,
            'campaign_id', NEW.campaign_id,
            'flow_id', NEW.flow_id,
            'flow_local_id', NEW.flow_local_id,
            'created_at', NEW.created_at
          );
        END IF;
        IF TG_OP <> 'INSERT' THEN
          v_old := jsonb_build_object('id', OLD.id, 'campaign_id', OLD.campaign_id);
        END IF;
      END IF;
      -- Tabela sem projeção: new/old ficam null (o evento vira só um sinal).
    END IF;

    PERFORM realtime.send(
      jsonb_build_object(
        'table', TG_TABLE_NAME,
        'eventType', TG_OP,
        'new', v_new,
        'old', v_old,
        'commit_timestamp', now()
      ),
      'db_change',
      'dispara-db',
      false
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'dispara_broadcast_change(%): %', TG_TABLE_NAME, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.dispara_broadcast_change() IS
  'Realtime do dashboard: publica no canal público dispara-db (evento db_change) só colunas whitelisted (sem PII), projetadas coluna a coluna. Ver 20261011000000_security_hardening.sql.';

-- Triggers só onde existe realtime.send (Supabase com Broadcast from Database).
-- Lista = tabelas que o frontend escuta (CentralizedRealtimeProvider + hooks/*).
-- Cada evento é 1 INSERT em realtime.messages: o recorte por tabela abaixo controla o volume.
DO $$
DECLARE
  v_table text;
  -- Volume baixo: por linha, em INSERT/UPDATE/DELETE.
  v_row_tables text[] := ARRAY[
    'templates',
    'flows',
    'inbox_conversations',
    'account_alerts',
    'template_projects',
    'template_project_items'
  ];
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RAISE NOTICE 'security_hardening: realtime.send indisponível; triggers de broadcast não criadas (realtime do dashboard fica só no polling).';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_row_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER dispara_realtime_broadcast AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change()',
      v_table
    );
  END LOOP;

  -- campaigns: increment_campaign_stat faz 1 UPDATE por delivered/read/failed de cada
  -- contato, e o dreno faz try_lock/release_campaign_dispatch_lock (só dispatch_lock_*).
  -- INSERT/DELETE publicam sempre. UPDATE só publica quando:
  --   (a) muda status, completed_at, cancelled_at ou folder_id (nunca pode se perder); ou
  --   (b) muda algo que a UI mostra (contadores, agenda, nome...) E é o primeiro UPDATE
  --       da campanha nesta janela fixa de 2s (OLD.updated_at, gravado pelo BEFORE
  --       trigger set_updated_at, caiu em outra janela). Sob fluxo contínuo de webhooks
  --       isso dá no máximo 1 evento a cada 2s por campanha. O que cair no fim de uma
  --       janela é coberto pelo refetch/polling da tela e pelo broadcast campaign_progress.
  -- UPDATE que só mexe em dispatch_lock_* (e updated_at) não entra em nenhum dos dois.
  IF to_regclass('public.campaigns') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.campaigns;
    CREATE TRIGGER dispara_realtime_broadcast
      AFTER INSERT OR DELETE ON public.campaigns
      FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();

    DROP TRIGGER IF EXISTS dispara_realtime_broadcast_update ON public.campaigns;
    CREATE TRIGGER dispara_realtime_broadcast_update
      AFTER UPDATE ON public.campaigns
      FOR EACH ROW
      WHEN (
        OLD.status IS DISTINCT FROM NEW.status
        OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
        OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
        OR OLD.folder_id IS DISTINCT FROM NEW.folder_id
        OR (
          (OLD.sent, OLD.delivered, OLD.read, OLD.failed, OLD.skipped, OLD.total_recipients,
           OLD.auto_reply_sent_count, OLD.quick_reply_match_count, OLD.fallback_sent_count,
           OLD.scheduled_date, OLD.started_at, OLD.name, OLD.flow_id, OLD.ab_test_enabled)
          IS DISTINCT FROM
          (NEW.sent, NEW.delivered, NEW.read, NEW.failed, NEW.skipped, NEW.total_recipients,
           NEW.auto_reply_sent_count, NEW.quick_reply_match_count, NEW.fallback_sent_count,
           NEW.scheduled_date, NEW.started_at, NEW.name, NEW.flow_id, NEW.ab_test_enabled)
          AND (
            OLD.updated_at IS NULL
            OR floor(extract(epoch FROM OLD.updated_at) / 2) <> floor(extract(epoch FROM now()) / 2)
          )
        )
      )
      EXECUTE FUNCTION public.dispara_broadcast_change();
  END IF;

  -- inbox_messages: INSERT/UPDATE por linha (nova mensagem, status de entrega).
  -- DELETE por STATEMENT: apagar uma conversa apaga as N mensagens em cascata, e um
  -- evento por linha seriam N INSERTs em realtime.messages (e N subtransações) dentro
  -- do DELETE. O frontend só invalida a lista nesse caso.
  IF to_regclass('public.inbox_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.inbox_messages;
    CREATE TRIGGER dispara_realtime_broadcast
      AFTER INSERT OR UPDATE ON public.inbox_messages
      FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();

    DROP TRIGGER IF EXISTS dispara_realtime_broadcast_delete ON public.inbox_messages;
    CREATE TRIGGER dispara_realtime_broadcast_delete
      AFTER DELETE ON public.inbox_messages
      FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change();
  END IF;

  -- flow_submissions: o frontend só usa INSERT (CampaignFlowPanel). UPDATE/DELETE em
  -- massa (ON DELETE SET NULL de contact_id no bulk_delete_contacts) não publicam.
  IF to_regclass('public.flow_submissions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.flow_submissions;
    CREATE TRIGGER dispara_realtime_broadcast
      AFTER INSERT ON public.flow_submissions
      FOR EACH ROW EXECUTE FUNCTION public.dispara_broadcast_change();
  END IF;

  -- contacts: import/bulk update mexe em milhares de linhas por statement.
  -- Um evento por statement basta (o frontend só invalida a lista/estatísticas).
  IF to_regclass('public.contacts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS dispara_realtime_broadcast ON public.contacts;
    CREATE TRIGGER dispara_realtime_broadcast
      AFTER INSERT OR UPDATE OR DELETE ON public.contacts
      FOR EACH STATEMENT EXECUTE FUNCTION public.dispara_broadcast_change();
  END IF;
END $$;

-- postgres_changes não é mais usado: tira as tabelas de public da publicação do Realtime
-- (evita decodificar WAL à toa, inclusive de campaign_contacts, e fecha o caminho caso
-- algum grant a anon volte no futuro).
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT schemaname, tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I', r.schemaname, r.tablename);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'security_hardening: não foi possível tirar %.% da publicação (%)', r.schemaname, r.tablename, SQLERRM;
    END;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 5) Funções: EXECUTE só para service_role (por último, cobre também a função acima)
-- -----------------------------------------------------------------------------
-- Inventário (grep em todas as migrations) de funções de public SEM REVOKE próprio até aqui:
--   claim_campaign_batch, reap_stuck_campaign_sending, try_lock_campaign_dispatch,
--   release_campaign_dispatch_lock (20260705000600_campaign_queue — SECURITY DEFINER),
--   dispara_cron_tick (20260705000100_cron_infra — SECURITY DEFINER, lê o Vault),
--   increment_campaign_auto_reply_counters (20260422000000 — SECURITY DEFINER sem search_path),
--   dispara_broadcast_change (esta migration).
-- As demais (init, 20260225*, 20260430*) já tinham REVOKE explícito; o REVOKE geral cobre todas.
-- Triggers não checam EXECUTE ao disparar; pg_cron roda dispara_cron_tick como o dono.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Desfaz o GRANT por schema que o Supabase dá a anon/authenticated em funções futuras.
-- ATENÇÃO: o EXECUTE a PUBLIC é um default GLOBAL do Postgres e NÃO pode ser revogado
-- por schema (a parte "FROM PUBLIC" abaixo não tem efeito). Toda função nova em public
-- precisa de `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated` explícito
-- na própria migration (lib/security-hardening-migration.test.ts verifica isso).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
