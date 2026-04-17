-- ============================================================
-- ETP Gestão — Script de setup completo
-- Cole e execute no SQL Editor do Supabase
-- Projeto: yynlwvawjohxybsumedu (etp-sponte)
-- ============================================================

-- ── 0. Função utilitária ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;


-- ── 1. Unidades ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_unidades (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj          text        NOT NULL DEFAULT '',
  nome          text        NOT NULL,
  cor           text        NOT NULL DEFAULT '#6366f1',
  codigo_sponte text        NOT NULL DEFAULT '',
  token_sponte  text        NOT NULL DEFAULT '',
  ativo         boolean     NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etp_unidades_cnpj ON public.etp_unidades (cnpj);
CREATE OR REPLACE TRIGGER trg_etp_unidades_atualizado_em
  BEFORE UPDATE ON public.etp_unidades
  FOR EACH ROW EXECUTE PROCEDURE public.set_atualizado_em();
ALTER TABLE public.etp_unidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage unidades" ON public.etp_unidades;
CREATE POLICY "Anon can manage unidades" ON public.etp_unidades FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage unidades" ON public.etp_unidades;
CREATE POLICY "Auth can manage unidades" ON public.etp_unidades FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 2. Categorias despesas ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_categorias_despesas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id      uuid        NOT NULL REFERENCES public.etp_unidades(id) ON DELETE CASCADE,
  categoria_id    integer     NOT NULL,
  nome            text        NOT NULL,
  ativo           boolean     NOT NULL DEFAULT true,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cat_unidade UNIQUE (unidade_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS idx_etp_cat_desp_unidade ON public.etp_categorias_despesas (unidade_id);
CREATE INDEX IF NOT EXISTS idx_etp_cat_desp_nome    ON public.etp_categorias_despesas (nome);
CREATE OR REPLACE TRIGGER trg_etp_cat_desp_atualizado_em
  BEFORE UPDATE ON public.etp_categorias_despesas
  FOR EACH ROW EXECUTE PROCEDURE public.set_atualizado_em();
ALTER TABLE public.etp_categorias_despesas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage categorias_despesas" ON public.etp_categorias_despesas;
CREATE POLICY "Anon can manage categorias_despesas" ON public.etp_categorias_despesas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage categorias_despesas" ON public.etp_categorias_despesas;
CREATE POLICY "Auth can manage categorias_despesas" ON public.etp_categorias_despesas FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 3. Contas a pagar ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_contas_pagar (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id       uuid          NOT NULL REFERENCES public.etp_unidades(id) ON DELETE CASCADE,
  conta_pagar_id   integer       NOT NULL,
  numero_parcela   text          NOT NULL,
  sacado           text,
  categoria        text,
  forma_cobranca   text,
  tipo_recebimento text,
  vencimento       date,
  data_pagamento   date,
  valor_parcela    numeric(12,2) NOT NULL DEFAULT 0,
  valor_pago       numeric(12,2) DEFAULT 0,
  situacao_parcela text          NOT NULL DEFAULT 'Pendente',
  sincronizado_em  timestamptz   NOT NULL DEFAULT now(),
  criado_em        timestamptz   NOT NULL DEFAULT now(),
  atualizado_em    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_conta_pagar_unidade UNIQUE (unidade_id, conta_pagar_id, numero_parcela)
);
CREATE INDEX IF NOT EXISTS idx_etp_cp_unidade        ON public.etp_contas_pagar (unidade_id);
CREATE INDEX IF NOT EXISTS idx_etp_cp_situacao        ON public.etp_contas_pagar (situacao_parcela);
CREATE INDEX IF NOT EXISTS idx_etp_cp_vencimento      ON public.etp_contas_pagar (vencimento);
CREATE INDEX IF NOT EXISTS idx_etp_cp_data_pagamento  ON public.etp_contas_pagar (data_pagamento);
CREATE INDEX IF NOT EXISTS idx_etp_cp_categoria       ON public.etp_contas_pagar (categoria);
CREATE OR REPLACE TRIGGER trg_etp_cp_atualizado_em
  BEFORE UPDATE ON public.etp_contas_pagar
  FOR EACH ROW EXECUTE PROCEDURE public.set_atualizado_em();
ALTER TABLE public.etp_contas_pagar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage contas_pagar" ON public.etp_contas_pagar;
CREATE POLICY "Anon can manage contas_pagar" ON public.etp_contas_pagar FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage contas_pagar" ON public.etp_contas_pagar;
CREATE POLICY "Auth can manage contas_pagar" ON public.etp_contas_pagar FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 4. Sync log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_sync_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id      uuid        REFERENCES public.etp_unidades(id) ON DELETE SET NULL,
  tipo_sync       text        NOT NULL,
  data_inicio     date,
  data_fim        date,
  total_registros integer     DEFAULT 0,
  status          text        NOT NULL DEFAULT 'sucesso',
  mensagem_erro   text,
  iniciado_em     timestamptz NOT NULL DEFAULT now(),
  concluido_em    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_etp_sync_log_unidade ON public.etp_sync_log (unidade_id);
ALTER TABLE public.etp_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage sync_log" ON public.etp_sync_log;
CREATE POLICY "Anon can manage sync_log" ON public.etp_sync_log FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage sync_log" ON public.etp_sync_log;
CREATE POLICY "Auth can manage sync_log" ON public.etp_sync_log FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 5. Planejamento (coluna mes_referencia como TEXT) ─────
CREATE TABLE IF NOT EXISTS public.etp_planejamento (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id      uuid          NOT NULL REFERENCES public.etp_unidades(id) ON DELETE CASCADE,
  mes_referencia  text          NOT NULL,   -- formato YYYY-MM ex: '2026-04'
  categoria       text          NOT NULL,
  valor_planejado numeric(12,2) NOT NULL DEFAULT 0,
  observacao      text,
  criado_em       timestamptz   NOT NULL DEFAULT now(),
  atualizado_em   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_planejamento_unidade_mes_cat UNIQUE (unidade_id, mes_referencia, categoria),
  CONSTRAINT chk_mes_referencia_format CHECK (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX IF NOT EXISTS idx_etp_plan_unidade  ON public.etp_planejamento (unidade_id);
CREATE INDEX IF NOT EXISTS idx_etp_plan_mes      ON public.etp_planejamento (mes_referencia);
CREATE OR REPLACE TRIGGER trg_etp_plan_atualizado_em
  BEFORE UPDATE ON public.etp_planejamento
  FOR EACH ROW EXECUTE PROCEDURE public.set_atualizado_em();
ALTER TABLE public.etp_planejamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage planejamento" ON public.etp_planejamento;
CREATE POLICY "Anon can manage planejamento" ON public.etp_planejamento FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage planejamento" ON public.etp_planejamento;
CREATE POLICY "Auth can manage planejamento" ON public.etp_planejamento FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 6. Categorias favoritas ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_categorias_favoritas (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text        NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etp_cat_fav_categoria ON public.etp_categorias_favoritas (categoria);
ALTER TABLE public.etp_categorias_favoritas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage categorias favoritas" ON public.etp_categorias_favoritas;
CREATE POLICY "Anon can manage categorias favoritas" ON public.etp_categorias_favoritas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage categorias favoritas" ON public.etp_categorias_favoritas;
CREATE POLICY "Auth can manage categorias favoritas" ON public.etp_categorias_favoritas FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 7. Plano de contas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etp_plano_contas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id    uuid        NOT NULL REFERENCES public.etp_unidades(id) ON DELETE CASCADE,
  nome          text        NOT NULL,
  tipo          text        NOT NULL CHECK (tipo IN ('grupo', 'sub_grupo', 'despesa')),
  grupo_nome    text,
  sub_grupo_nome text,
  sort_order    integer     NOT NULL DEFAULT 0,
  ativo         boolean     NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etp_pc_unidade    ON public.etp_plano_contas (unidade_id);
CREATE INDEX IF NOT EXISTS idx_etp_pc_tipo       ON public.etp_plano_contas (tipo);
CREATE INDEX IF NOT EXISTS idx_etp_pc_sort       ON public.etp_plano_contas (sort_order);
CREATE OR REPLACE TRIGGER trg_etp_pc_atualizado_em
  BEFORE UPDATE ON public.etp_plano_contas
  FOR EACH ROW EXECUTE PROCEDURE public.set_atualizado_em();
ALTER TABLE public.etp_plano_contas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can manage plano_contas" ON public.etp_plano_contas;
CREATE POLICY "Anon can manage plano_contas" ON public.etp_plano_contas FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Auth can manage plano_contas" ON public.etp_plano_contas;
CREATE POLICY "Auth can manage plano_contas" ON public.etp_plano_contas FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── FIM ───────────────────────────────────────────────────
SELECT 'Setup completo!' AS status;
