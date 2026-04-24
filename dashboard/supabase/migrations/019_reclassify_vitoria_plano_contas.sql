-- ============================================================
-- Migration 019: Reclassifica grupo_nome do plano de contas da
-- unidade ETP - Vitoria, alinhando-a com o padrao das demais
-- unidades (Gravata / Jaboatao).
--
-- Motivacao:
--   O import original da Vitoria copiou o grupo_nome bruto da
--   Sponte ("ETP - ESCOLA TECNICA PARTICULAR", "Despesas 1",
--   "DESPESAS 2"), ao inves de usar os 9 grupos contabeis
--   padrao ja curados nas demais unidades. Isto fazia com que
--   o planejamento exibisse tudo em "SEM GRUPO DEFINIDO".
--
-- Estrategia:
--   1. Para cada despesa da Vitoria, procurar pelo mesmo
--      nome (case-insensitive, trimmed) em Gravata/Jaboatao.
--      Usar o grupo_nome mais votado como referencia.
--   2. Para despesas que nao existem em Gravata/Jaboatao,
--      aplicar heuristica por nome (palavras-chave).
--   3. Preservar registros ja com grupo_nome valido.
-- ============================================================

BEGIN;

-- 1) Reclassificacao por correspondencia direta de nome -----
WITH referencia AS (
  SELECT
    LOWER(TRIM(pc.nome)) AS nome_norm,
    pc.grupo_nome,
    COUNT(*) AS votes
  FROM etp_plano_contas pc
  JOIN etp_unidades u ON u.id = pc.unidade_id
  WHERE u.nome IN ('ETP - Gravatá', 'ETP - Jaboatão')
    AND pc.tipo = 'despesa'
    AND pc.ativo = true
  GROUP BY LOWER(TRIM(pc.nome)), pc.grupo_nome
),
best AS (
  SELECT DISTINCT ON (nome_norm) nome_norm, grupo_nome
  FROM referencia
  ORDER BY nome_norm, votes DESC
)
UPDATE etp_plano_contas pc
SET grupo_nome = b.grupo_nome
FROM best b, etp_unidades u
WHERE u.nome = 'ETP - Vitória'
  AND pc.unidade_id = u.id
  AND pc.tipo = 'despesa'
  AND LOWER(TRIM(pc.nome)) = b.nome_norm
  AND pc.grupo_nome IS DISTINCT FROM b.grupo_nome;

-- 2) Heuristica para despesas sem correspondencia direta ----
UPDATE etp_plano_contas pc
SET grupo_nome = CASE
  -- DESPESAS FIXAS: aluguel, utilidades, telefonia, sistemas
  WHEN pc.nome ILIKE 'ALUGUEL%'              THEN 'DESPESAS FIXAS'
  WHEN pc.nome ILIKE 'COMPESA%'              THEN 'DESPESAS FIXAS'
  WHEN pc.nome ILIKE 'INTERNET%'             THEN 'DESPESAS FIXAS'
  WHEN pc.nome = 'Energia'                   THEN 'DESPESAS FIXAS'
  WHEN pc.nome = 'CONTA TELEFONICA'          THEN 'DESPESAS FIXAS'
  WHEN pc.nome = 'Telefonia'                 THEN 'DESPESAS FIXAS'
  WHEN pc.nome = 'Sistema de Ponto'          THEN 'DESPESAS FIXAS'
  WHEN pc.nome = 'Suporte'                   THEN 'DESPESAS FIXAS'

  -- DESPESAS VARIAVEIS: consumo, treinamento, propaganda
  WHEN pc.nome = 'COMBUSTIVEL VEICULOS'      THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome ILIKE 'Consultorias%'         THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome ILIKE 'Elabora%Apostilh%'     THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome ILIKE 'Material Limp%'        THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome ILIKE 'Material p%Copa'       THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome ILIKE 'Material pra Copa'     THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome = 'PROPAGANDA'                THEN 'DESPESAS VARIAVEIS'
  WHEN pc.nome = 'Transporte'                THEN 'DESPESAS VARIAVEIS'

  -- FOLHA DE PAGAMENTO: qualquer folha/professor/funcionario
  WHEN pc.nome = 'COMISSÃO/PREMIAÇÃO'        THEN 'FOLHA DE PAGAMENTO'
  WHEN pc.nome = 'EXAME FUNCIONARIOS'        THEN 'FOLHA DE PAGAMENTO'
  WHEN pc.nome = 'FOLHA DE PAGAMENTO'        THEN 'FOLHA DE PAGAMENTO'
  WHEN pc.nome ILIKE 'Folha %'               THEN 'FOLHA DE PAGAMENTO'
  WHEN pc.nome = 'Pagamento de Professores'  THEN 'FOLHA DE PAGAMENTO'

  -- PRO-LABORE: tudo marcado como (PESSOAL)/(Pessoal) ou Despesas Pessoal
  WHEN pc.nome = 'Despesas Pessoal'          THEN 'PRO-LABORE'
  WHEN pc.nome ILIKE '%(PESSOAL)%'           THEN 'PRO-LABORE'
  WHEN pc.nome ILIKE '%(Pessoal)%'           THEN 'PRO-LABORE'
  WHEN pc.nome = 'MATERIAL DE CONTRUÇÃO/CASA' THEN 'PRO-LABORE'

  -- DESPESAS BANCARIAS
  WHEN pc.nome = 'Tarifa Bancarias'          THEN 'DESPESAS BANCARIAS'

  -- OUTROS
  WHEN pc.nome = 'DEVOLUÇÃO'                 THEN 'OUTROS'
  WHEN pc.nome ILIKE 'CONSÓRCIO%'            THEN 'OUTROS'

  -- DESPESAS_PADRAO: itens nao classificaveis
  WHEN pc.nome = 'CDL'                       THEN 'DESPESAS_PADRAO'

  ELSE pc.grupo_nome
END
FROM etp_unidades u
WHERE u.nome = 'ETP - Vitória'
  AND pc.unidade_id = u.id
  AND pc.tipo = 'despesa'
  AND pc.grupo_nome NOT IN (
    'PRO-LABORE', 'DESPESAS VARIAVEIS', 'DESPESAS FIXAS',
    'FOLHA DE PAGAMENTO', 'IMPOSTOS', 'DESPESAS_PADRAO',
    'DESPESAS BANCARIAS', 'MANUTENÇÃO', 'OUTROS'
  );

-- 3) Fallback final: qualquer despesa ainda nao classificada
--    vai para DESPESAS_PADRAO (bucket neutro).
UPDATE etp_plano_contas pc
SET grupo_nome = 'DESPESAS_PADRAO'
FROM etp_unidades u
WHERE u.nome = 'ETP - Vitória'
  AND pc.unidade_id = u.id
  AND pc.tipo = 'despesa'
  AND pc.grupo_nome NOT IN (
    'PRO-LABORE', 'DESPESAS VARIAVEIS', 'DESPESAS FIXAS',
    'FOLHA DE PAGAMENTO', 'IMPOSTOS', 'DESPESAS_PADRAO',
    'DESPESAS BANCARIAS', 'MANUTENÇÃO', 'OUTROS'
  );

COMMIT;
