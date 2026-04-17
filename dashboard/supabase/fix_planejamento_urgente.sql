-- ============================================================
-- FIX URGENTE: etp_planejamento
-- Corrige 2 problemas:
--   1. Política RLS anon ausente (migration 004 removeu)
--   2. Coluna mes_referencia tipo DATE → TEXT (migration 006 nunca aplicada)
--
-- Execute no SQL Editor:
-- https://supabase.com/dashboard/project/yynlwvawjohxybsumedu/sql/new
-- ============================================================

-- ── 1. Recriar política anon (o app usa anon key) ────────────
DROP POLICY IF EXISTS "Anon can manage planejamento" ON public.etp_planejamento;
CREATE POLICY "Anon can manage planejamento"
  ON public.etp_planejamento
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- ── 2. Converter mes_referencia de DATE para TEXT ────────────
-- (se já for text, os comandos são idempotentes / ignoram)
ALTER TABLE public.etp_planejamento
  DROP CONSTRAINT IF EXISTS uq_planejamento_unidade_mes_cat;

ALTER TABLE public.etp_planejamento
  DROP CONSTRAINT IF EXISTS chk_mes_referencia_format;

-- Converte DATE → TEXT (se já for text, o USING converte text→text sem erro)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'etp_planejamento'
      AND column_name = 'mes_referencia'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE public.etp_planejamento
      ALTER COLUMN mes_referencia TYPE text USING to_char(mes_referencia, 'YYYY-MM');
    RAISE NOTICE 'mes_referencia convertido de DATE para TEXT';
  ELSE
    RAISE NOTICE 'mes_referencia já é TEXT, nenhuma conversão necessária';
  END IF;
END $$;

-- Recriar constraints
ALTER TABLE public.etp_planejamento
  ADD CONSTRAINT uq_planejamento_unidade_mes_cat UNIQUE (unidade_id, mes_referencia, categoria);

ALTER TABLE public.etp_planejamento
  ADD CONSTRAINT chk_mes_referencia_format CHECK (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ── 3. Garantir políticas anon nas outras tabelas também ─────
-- (para não quebrar leituras futuras)
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'etp_unidades',
      'etp_categorias_despesas',
      'etp_contas_pagar',
      'etp_sync_log',
      'etp_categorias_favoritas',
      'etp_plano_contas'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Anon can manage %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "Anon can manage %s" ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

SELECT 'Fix aplicado com sucesso!' AS status;
