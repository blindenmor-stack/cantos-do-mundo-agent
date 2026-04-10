-- =====================================================================
-- Migration: 20260410_production_ready
-- Purpose: Tornar o agente Cantos do Mundo production-ready
-- Run: Supabase Dashboard → SQL Editor → New query → paste → Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NOVA COLUNA: source em leads + conversations (diferenciar ad vs orgânico)
-- ---------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS is_test boolean DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS buffer_lock_at timestamptz;

-- Backfill: conversations que já têm ad_id no lead são "meta_ad", resto "organic"
UPDATE conversations c
SET source = CASE
  WHEN l.ad_id IS NOT NULL OR l.ctwa_clid IS NOT NULL THEN 'meta_ad'
  ELSE 'organic'
END
FROM leads l
WHERE c.lead_id = l.id AND c.source IS NULL;

-- ---------------------------------------------------------------------
-- 2. TABELA: excluded_phones — whitelist de números que NÃO devem receber bot
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS excluded_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  label text,
  reason text,
  added_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_excluded_phones_phone ON excluded_phones(phone);

COMMENT ON TABLE excluded_phones IS 'Números que o bot NUNCA deve qualificar (clientes existentes, parceiros, etc)';

-- ---------------------------------------------------------------------
-- 3. TABELA: notify_targets — destinos de notificação (número ou grupo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notify_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text NOT NULL,           -- phone number ou group ID (ex: "120363407808868215-group")
  type text NOT NULL CHECK (type IN ('phone', 'group')),
  label text NOT NULL,
  notify_qualified boolean DEFAULT true,
  notify_warm boolean DEFAULT false,
  notify_daily_report boolean DEFAULT true,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (target, type)
);

CREATE INDEX IF NOT EXISTS idx_notify_targets_active ON notify_targets(active) WHERE active = true;

COMMENT ON TABLE notify_targets IS 'Onde enviar alertas de qualificação e relatório diário';

-- Seed: grupo Agente Miry - Cantos do Mundo
INSERT INTO notify_targets (target, type, label, notify_qualified, notify_warm, notify_daily_report)
VALUES ('120363407808868215-group', 'group', 'Grupo Agente Miry - Cantos do Mundo', true, false, true)
ON CONFLICT (target, type) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. TABELA: conversation_events — histórico de transições (analytics + debug)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_events (
  id bigserial PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL,        -- 'step_change' | 'handoff' | 'bot_toggle' | 'score_update' | 'bot_skipped'
  from_value text,
  to_value text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_conv ON conversation_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_events_type ON conversation_events(event_type);

COMMENT ON TABLE conversation_events IS 'Log de eventos de cada conversa — transições de step, handoffs, toggles do bot';

-- ---------------------------------------------------------------------
-- 5. ÍNDICES pra performance do dashboard
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_qualification_status ON leads(qualification_status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ad_id ON leads(ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_active ON conversations(bot_active) WHERE bot_active = true;
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- ---------------------------------------------------------------------
-- 6. agent_config: novas keys pra modo ad-only e horário comercial
-- ---------------------------------------------------------------------
INSERT INTO agent_config (key, value, description) VALUES
  ('bot_mode', 'all',        'Modo do bot: "ad_only" (só anúncios) ou "all" (todos os números novos)'),
  ('quiet_hours_enabled', 'false', 'Se true, bot não responde em horário de silêncio'),
  ('quiet_hours_start', '22:00',   'Início do horário silencioso (HH:MM)'),
  ('quiet_hours_end',   '08:00',   'Fim do horário silencioso (HH:MM)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. VIEWS pra analytics (facilita relatório diário e dashboard)
-- ---------------------------------------------------------------------

-- Funil diário
CREATE OR REPLACE VIEW v_daily_funnel AS
SELECT
  DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo') AS day,
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE l.ad_id IS NOT NULL OR l.ctwa_clid IS NOT NULL) AS from_ads,
  COUNT(*) FILTER (WHERE l.qualification_status = 'qualified') AS qualified,
  COUNT(*) FILTER (WHERE l.qualification_status = 'warm') AS warm,
  COUNT(*) FILTER (WHERE l.qualification_status = 'disqualified') AS disqualified,
  COUNT(*) FILTER (WHERE l.qualification_status = 'pending') AS pending,
  ROUND(AVG(l.qualification_score) FILTER (WHERE l.qualification_score > 0)::numeric, 1) AS avg_score
FROM leads l
GROUP BY DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo')
ORDER BY day DESC;

-- Performance por anúncio
CREATE OR REPLACE VIEW v_ad_performance AS
SELECT
  ad_id,
  campaign_id,
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE qualification_status = 'qualified') AS qualified,
  COUNT(*) FILTER (WHERE qualification_status = 'warm') AS warm,
  COUNT(*) FILTER (WHERE qualification_status = 'disqualified') AS disqualified,
  ROUND(
    COUNT(*) FILTER (WHERE qualification_status = 'qualified')::numeric
    / NULLIF(COUNT(*), 0) * 100,
    2
  ) AS qualification_rate_pct,
  MIN(created_at) AS first_lead_at,
  MAX(created_at) AS last_lead_at
FROM leads
WHERE ad_id IS NOT NULL
GROUP BY ad_id, campaign_id
ORDER BY total_leads DESC;

-- Health de conversas (quem tá travado)
CREATE OR REPLACE VIEW v_conversation_health AS
SELECT
  c.id,
  c.phone,
  l.name,
  c.current_step,
  c.messages_count,
  c.bot_messages_count,
  c.bot_active,
  c.last_message_at,
  c.handoff_at,
  l.qualification_status,
  CASE
    WHEN c.handoff_at IS NOT NULL THEN 'handed_off'
    WHEN c.messages_count > 20 AND c.current_step IN ('greeting','destination') THEN 'stuck'
    WHEN EXTRACT(EPOCH FROM (now() - c.last_message_at))/3600 > 24 AND c.handoff_at IS NULL THEN 'abandoned'
    WHEN c.bot_active = false THEN 'paused'
    ELSE 'active'
  END AS health
FROM conversations c
LEFT JOIN leads l ON l.id = c.lead_id
ORDER BY c.last_message_at DESC NULLS LAST;

-- ---------------------------------------------------------------------
-- 8. RLS policies (mantém seguro mesmo sem auth no middleware ainda)
-- ---------------------------------------------------------------------
ALTER TABLE excluded_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;

-- Policies permissivas temporárias (anon tem acesso porque backend usa anon key)
-- TODO: restringir quando middleware de auth for implementado
DROP POLICY IF EXISTS "allow_all_excluded" ON excluded_phones;
CREATE POLICY "allow_all_excluded" ON excluded_phones FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_targets" ON notify_targets;
CREATE POLICY "allow_all_targets" ON notify_targets FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_events" ON conversation_events;
CREATE POLICY "allow_all_events" ON conversation_events FOR ALL TO anon USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- FIM
-- ---------------------------------------------------------------------
-- Verificação pós-execução: rodar no SQL Editor depois
-- SELECT * FROM notify_targets;
-- SELECT * FROM agent_config WHERE key IN ('bot_mode','quiet_hours_enabled');
-- SELECT * FROM v_daily_funnel LIMIT 10;
