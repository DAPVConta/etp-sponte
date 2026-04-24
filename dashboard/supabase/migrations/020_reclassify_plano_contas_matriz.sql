-- ============================================================
-- Migration 020: Reclassifica a matriz global do plano de
-- contas (etp_plano_contas_matriz) para os 9 grupos padrao
-- contabeis ja usados por Gravata/Jaboatao.
--
-- Motivacao:
--   A matriz foi populada direto com o payload bruto da Sponte
--   (grupo_nome = "DESPESAS 2", "Despesas 1", "ETP - ESCOLA
--   TECNICA PARTICULAR"). Como a matriz e o template para
--   novas unidades, qualquer unidade seedada a partir dela
--   herda a classificacao errada — foi o que aconteceu com
--   Vitoria (ver migration 019).
--
-- Estrategia:
--   1. Garantir que os 9 grupos padrao existam na matriz
--      (DESPESAS BANCARIAS, DESPESAS FIXAS, DESPESAS VARIAVEIS,
--      FOLHA DE PAGAMENTO, IMPOSTOS, MANUTENCAO, OUTROS,
--      PRO-LABORE, DESPESAS_PADRAO).
--   2. Reclassificar despesas por correspondencia de nome com
--      Gravata/Jaboatao (~135 matches).
--   3. Heuristica por palavra-chave para o restante.
--   4. Fallback DESPESAS_PADRAO.
--   5. Desativar os 3 grupos brutos originais.
-- ============================================================

BEGIN;

-- 1) Inserir os 9 grupos padrao na matriz (idempotente) ------
INSERT INTO etp_plano_contas_matriz (nome, tipo, grupo_nome, ativo, status, sort_order)
SELECT g.nome, 'grupo', g.nome, true, 'ativo', g.sort_order
FROM (VALUES
  ('DESPESAS BANCARIAS',  1),
  ('DESPESAS FIXAS',      9),
  ('DESPESAS VARIAVEIS', 32),
  ('FOLHA DE PAGAMENTO', 58),
  ('IMPOSTOS',           80),
  ('MANUTENÇÃO',         97),
  ('OUTROS',            104),
  ('PRO-LABORE',        107),
  ('DESPESAS_PADRAO',   138)
) AS g(nome, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM etp_plano_contas_matriz x
  WHERE x.tipo='grupo' AND x.nome = g.nome
);

-- 2) Reclassificacao por correspondencia exata de nome -------
WITH referencia AS (
  SELECT LOWER(TRIM(pc.nome)) AS nome_norm, pc.grupo_nome, COUNT(*) AS votes
  FROM etp_plano_contas pc
  JOIN etp_unidades u ON u.id = pc.unidade_id
  WHERE u.nome IN ('ETP - Gravatá', 'ETP - Jaboatão')
    AND pc.tipo='despesa' AND pc.ativo=true
  GROUP BY LOWER(TRIM(pc.nome)), pc.grupo_nome
),
best AS (
  SELECT DISTINCT ON (nome_norm) nome_norm, grupo_nome
  FROM referencia
  ORDER BY nome_norm, votes DESC
)
UPDATE etp_plano_contas_matriz m
SET grupo_nome = b.grupo_nome
FROM best b
WHERE m.tipo='despesa'
  AND LOWER(TRIM(m.nome)) = b.nome_norm
  AND m.grupo_nome IS DISTINCT FROM b.grupo_nome;

-- 3) Heuristica por palavra-chave ---------------------------
-- Ordem de precedencia importa: PRO-LABORE primeiro (pattern
-- "(Pessoal)" sobrescreve outras categorias), depois FOLHA,
-- depois IMPOSTOS, MANUTENCAO, BANCARIAS, FIXAS, VARIAVEIS,
-- OUTROS, fallback.
UPDATE etp_plano_contas_matriz m
SET grupo_nome = CASE

  -- PRO-LABORE: sufixo (Pessoal) em qualquer casing
  WHEN m.nome ~* '\((pessoal|pessoais)\)'                   THEN 'PRO-LABORE'
  WHEN m.nome ILIKE 'Despesas Pessoal%'                      THEN 'PRO-LABORE'
  WHEN m.nome ILIKE '%DISPESAS PESSOAIS%'                    THEN 'PRO-LABORE'
  WHEN m.nome ILIKE '%MATERIAL DE CONTRU%CASA%'              THEN 'PRO-LABORE'

  -- FOLHA DE PAGAMENTO
  WHEN m.nome ILIKE 'FOLHA %' OR m.nome ILIKE 'Folha %'      THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome = 'FOLHA DE PAGAMENTO'                         THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%estagi%' OR m.nome ILIKE '%horista%'   THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%Hora Extra%'                           THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%encargos sociais%'                     THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'FGTS%' OR m.nome ILIKE 'Fgts%'          THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'GPS%' OR m.nome ILIKE 'Gps%'            THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Ferias%' OR m.nome ILIKE 'FÉRIAS%'      THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '13%salario%' OR m.nome ILIKE '13%salário%' THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%RESCIS%'                               THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome = 'Resc'                                       THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Horistas'                               THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%TREINAMENTO FUNCIONARIO%'              THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%CURSO PARA FUNCIONARIO%'               THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'EXAME FUNCIONARIOS%'                    THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%COM FUNCIONARIO%'                      THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Acordo com Funcionarios%'               THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Ajuda de custo%'                        THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'VALE TRANSPO%'                          THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Comiss%' OR m.nome ILIKE 'COMISSÃO%'    THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Premia%'                                THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Pagamento de Professores%'              THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE 'Pagamento do Segurança%'                THEN 'FOLHA DE PAGAMENTO'
  WHEN m.nome ILIKE '%Vigia%'                                THEN 'FOLHA DE PAGAMENTO'

  -- IMPOSTOS
  WHEN m.nome ILIKE 'IPTU%' OR m.nome ILIKE 'Iptu%'          THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'IPVA%' OR m.nome ILIKE 'IPV%'           THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'ISS%'                                   THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'DARF%' OR m.nome ILIKE 'Darf%'          THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'DAE%'  OR m.nome ILIKE 'Dae%'           THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'DV.%ATIVA%'                             THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'simples%'                               THEN 'IMPOSTOS'
  WHEN m.nome ILIKE '%Impostos%'                             THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'Multa Governo%'                         THEN 'IMPOSTOS'
  WHEN m.nome ILIKE 'MULTA%RESCIS%'                          THEN 'IMPOSTOS'

  -- DESPESAS BANCARIAS
  WHEN m.nome ILIKE 'Tarifa%'                                THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'TAXA%BOLETO%'                           THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'TAXAS%SOBRE%PIX%'                       THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'TAXA%CART%'                             THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'TAXA OP.%'                              THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'JUROS%'                                 THEN 'DESPESAS BANCARIAS'
  WHEN m.nome ILIKE 'Manutenção cart%'                       THEN 'DESPESAS BANCARIAS'

  -- MANUTENCAO
  WHEN m.nome ILIKE 'Manuten%'                               THEN 'MANUTENÇÃO'
  WHEN m.nome ILIKE 'Reforma%'                               THEN 'MANUTENÇÃO'
  WHEN m.nome ILIKE 'MANUTENÇÃO%'                            THEN 'MANUTENÇÃO'

  -- DESPESAS FIXAS (aluguel, utilidades, telefonia, sistemas, seguros)
  WHEN m.nome ILIKE 'ALUGUEL%' OR m.nome ILIKE 'Aluguel%'    THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Locação%'                               THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'COMPESA%' OR m.nome ILIKE 'Compesa%'    THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Agua%' OR m.nome ILIKE 'AGUA%'          THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Energi%'                                THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'INTERNET%' OR m.nome ILIKE 'Internet%'  THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Telefone%'                              THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Telefonia%'                             THEN 'DESPESAS FIXAS'
  WHEN m.nome = 'CONTA TELEFONICA'                           THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Celular%' OR m.nome ILIKE 'CLARO%'      THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Sistema%' OR m.nome = 'SISTEMA'         THEN 'DESPESAS FIXAS'
  WHEN m.nome = 'Suporte'                                    THEN 'DESPESAS FIXAS'
  WHEN m.nome = 'Condominio'                                 THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Seguro%'                                THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Plataforma%'                            THEN 'DESPESAS FIXAS'
  WHEN m.nome = 'GÁS'                                        THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Fita Larga'                             THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Associa%'                               THEN 'DESPESAS FIXAS'
  WHEN m.nome ILIKE 'Bombeiros%'                             THEN 'DESPESAS FIXAS'

  -- DESPESAS VARIAVEIS (consumiveis, marketing, transporte)
  WHEN m.nome ILIKE 'MATERIAL%' OR m.nome ILIKE 'Material%'  THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Materialde%' OR m.nome ILIKE 'Materias%' THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'limp%' OR m.nome ILIKE 'Limp%'          THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome = 'Detergente'                                 THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'PROPAGANDA%'                            THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Panflet%'                               THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Marketing%'                             THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Redes Soc%'                             THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'FILMAGEM%'                              THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome = 'COMBUSTIVEL VEICULOS'                       THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Combustivel%' OR m.nome ILIKE 'Combustível%' THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'GASOLINA%'                              THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome = 'Transporte'                                 THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Transporte%'                            THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Passagem%' OR m.nome ILIKE 'Passagens%' THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Motoboy%'                               THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Frete%'                                 THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Almoço%' OR m.nome ILIKE 'Alimenta%'    THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Refei%'                                 THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Café%'                                  THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Um pacote de Café%'                     THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Refrigerante%'                          THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Brindes%'                               THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Fardamento%' OR m.nome = 'Vestuario'    THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Moveis%'                                THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Papel%'                                 THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Apostilh%' OR m.nome ILIKE 'Elabora%Apostilh%' THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Consultoria%' OR m.nome ILIKE 'Consultorias%' THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome = 'Carimbo'                                    THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Cart%rio%'                              THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Cópias%'                                THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Pote%'                                  THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Sorteio%'                               THEN 'DESPESAS VARIAVEIS'
  WHEN m.nome ILIKE 'Peças%' OR m.nome ILIKE 'PEÇAS%'        THEN 'DESPESAS VARIAVEIS'

  -- OUTROS
  WHEN m.nome ILIKE 'DEVOLUÇÃO%' OR m.nome ILIKE 'Devolu%'   THEN 'OUTROS'
  WHEN m.nome ILIKE 'DEV TAXA%'                              THEN 'OUTROS'
  WHEN m.nome ILIKE 'Consorcio%' OR m.nome ILIKE 'CONSÓRCIO%' THEN 'OUTROS'
  WHEN m.nome ILIKE '%desativa%' OR m.nome ILIKE '%desati%'  THEN 'OUTROS'
  WHEN m.nome ILIKE 'Demais despesas%'                       THEN 'OUTROS'

  ELSE m.grupo_nome
END
WHERE m.tipo = 'despesa'
  AND m.grupo_nome NOT IN (
    'PRO-LABORE', 'DESPESAS VARIAVEIS', 'DESPESAS FIXAS',
    'FOLHA DE PAGAMENTO', 'IMPOSTOS', 'DESPESAS_PADRAO',
    'DESPESAS BANCARIAS', 'MANUTENÇÃO', 'OUTROS'
  );

-- 4) Fallback: qualquer despesa ainda sem classificacao -----
UPDATE etp_plano_contas_matriz m
SET grupo_nome = 'DESPESAS_PADRAO'
WHERE m.tipo = 'despesa'
  AND m.grupo_nome NOT IN (
    'PRO-LABORE', 'DESPESAS VARIAVEIS', 'DESPESAS FIXAS',
    'FOLHA DE PAGAMENTO', 'IMPOSTOS', 'DESPESAS_PADRAO',
    'DESPESAS BANCARIAS', 'MANUTENÇÃO', 'OUTROS'
  );

-- 5) Desativar os grupos brutos originais ------------------
UPDATE etp_plano_contas_matriz m
SET status = 'inativo', ativo = false
WHERE m.tipo = 'grupo'
  AND m.nome IN ('Despesas 1', 'DESPESAS 2', 'ETP - ESCOLA TECNICA PARTICULAR',
                 'Despesas Pessoal 1', 'ESCOLA TECNICA PARTICULAR');

COMMIT;
