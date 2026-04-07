-- ══════════════════════════════════════════════════════════════
-- Tabela: etp_planejamento
-- Armazena o valor planejado por unidade, mês e categoria
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS etp_planejamento (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id       UUID         NOT NULL REFERENCES etp_unidades(id) ON DELETE CASCADE,
  mes_referencia   CHAR(7)      NOT NULL,   -- formato 'YYYY-MM'
  categoria        TEXT         NOT NULL,
  valor_planejado  NUMERIC(15,2) NOT NULL DEFAULT 0,
  observacao       TEXT,
  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (unidade_id, mes_referencia, categoria)
);

-- Índice para buscas por período e unidade
CREATE INDEX IF NOT EXISTS idx_planejamento_unidade_mes
  ON etp_planejamento (unidade_id, mes_referencia);

-- Trigger para atualizar atualizado_em automaticamente
CREATE OR REPLACE FUNCTION etp_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planejamento_updated_at ON etp_planejamento;
CREATE TRIGGER trg_planejamento_updated_at
  BEFORE UPDATE ON etp_planejamento
  FOR EACH ROW EXECUTE FUNCTION etp_set_updated_at();

-- RLS: habilitar (ajuste policies conforme autenticação do projeto)
ALTER TABLE etp_planejamento ENABLE ROW LEVEL SECURITY;

-- Policy permissiva (ajuste para auth.uid() se usar autenticação por usuário)
CREATE POLICY "allow_all_planejamento" ON etp_planejamento
  FOR ALL USING (true) WITH CHECK (true);
