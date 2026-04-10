-- ============================================================
-- ETP Gestão — Migration 005
-- Adiciona sort_order em etp_plano_contas e ressemeia Gravatá
-- baseado no documento oficial "plano de contas - GRAVATA.pdf"
-- ============================================================

-- 1. Coluna de ordenação
alter table public.etp_plano_contas
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_etp_pc_sort
  on public.etp_plano_contas (unidade_id, sort_order);

-- 2. Reseed Gravatá (delete + insert com hierarquia e ordem corretas)
do $$
declare
  v_uid uuid;
begin
  select id into v_uid
  from public.etp_unidades
  where nome ilike '%gravat%'
  limit 1;

  if v_uid is null then
    raise notice 'Unidade Gravatá não encontrada — seed ignorado.';
    return;
  end if;

  -- Remove dados anteriores (inclusive possível corrupção do sync da API)
  delete from public.etp_plano_contas where unidade_id = v_uid;

  -- Insere na ordem exata do PDF (sort_order garante a ordenação no front-end)
  insert into public.etp_plano_contas
    (unidade_id, nome, tipo, grupo_nome, sub_grupo_nome, sort_order)
  values
  -- ── DESPESAS BANCARIAS ─────────────────────────────────────
  (v_uid, 'DESPESAS BANCARIAS',                      'grupo',     'DESPESAS BANCARIAS',   null,                     1),
  (v_uid, 'Emprestimos',                             'despesa',   'DESPESAS BANCARIAS',   null,                     2),
  (v_uid, 'Iof',                                     'despesa',   'DESPESAS BANCARIAS',   null,                     3),
  (v_uid, 'Juros',                                   'despesa',   'DESPESAS BANCARIAS',   null,                     4),
  (v_uid, 'Tarifas Bancarias',                       'despesa',   'DESPESAS BANCARIAS',   null,                     5),
  (v_uid, 'Tarifas Boleto',                          'despesa',   'DESPESAS BANCARIAS',   null,                     6),
  (v_uid, 'Taxa Adm Cartão',                         'despesa',   'DESPESAS BANCARIAS',   null,                     7),
  (v_uid, 'Taxa de Antecipação',                     'despesa',   'DESPESAS BANCARIAS',   null,                     8),

  -- ── DESPESAS FIXAS ─────────────────────────────────────────
  (v_uid, 'DESPESAS FIXAS',                          'grupo',     'DESPESAS FIXAS',       null,                     9),
  (v_uid, 'Agua Mineral',                            'despesa',   'DESPESAS FIXAS',       null,                    10),
  (v_uid, 'Aluguel Predial',                         'despesa',   'DESPESAS FIXAS',       null,                    11),
  (v_uid, 'Associação / Sindicatos',                 'despesa',   'DESPESAS FIXAS',       null,                    12),
  (v_uid, 'Celpe (energia)',                         'despesa',   'DESPESAS FIXAS',       null,                    13),
  (v_uid, 'Coleta de Lixo',                          'despesa',   'DESPESAS FIXAS',       null,                    14),
  (v_uid, 'COMBUSTIVEL VEICULOS',                    'sub_grupo', 'DESPESAS FIXAS',       'COMBUSTIVEL VEICULOS',  15),
  (v_uid, 'Combustivel Celta',                       'despesa',   'DESPESAS FIXAS',       'COMBUSTIVEL VEICULOS',  16),
  (v_uid, 'Combustivel Celta Professores',           'despesa',   'DESPESAS FIXAS',       'COMBUSTIVEL VEICULOS',  17),
  (v_uid, 'Combustivel Deslocamento Funcionarios',   'despesa',   'DESPESAS FIXAS',       'COMBUSTIVEL VEICULOS',  18),
  (v_uid, 'Compesa (Água)',                          'despesa',   'DESPESAS FIXAS',       null,                    19),
  (v_uid, 'Consultorias / Treinamento',              'despesa',   'DESPESAS FIXAS',       null,                    20),
  (v_uid, 'Contador',                                'despesa',   'DESPESAS FIXAS',       null,                    21),
  (v_uid, 'Elaboração Apostilhas',                   'despesa',   'DESPESAS FIXAS',       null,                    22),
  (v_uid, 'Material Apostilha',                      'despesa',   'DESPESAS FIXAS',       null,                    23),
  (v_uid, 'Material de aula pratica',                'despesa',   'DESPESAS FIXAS',       null,                    24),
  (v_uid, 'Material de aula pratica (Curso Extra)',  'despesa',   'DESPESAS FIXAS',       null,                    25),
  (v_uid, 'Material de Expediente',                  'despesa',   'DESPESAS FIXAS',       null,                    26),
  (v_uid, 'Material Limpeza',                        'despesa',   'DESPESAS FIXAS',       null,                    27),
  (v_uid, 'Segurança',                               'despesa',   'DESPESAS FIXAS',       null,                    28),
  (v_uid, 'Seguro Auto / Outros',                    'despesa',   'DESPESAS FIXAS',       null,                    29),
  (v_uid, 'Sistema / Automação',                     'despesa',   'DESPESAS FIXAS',       null,                    30),
  (v_uid, 'Telefone/Movel/Internet',                 'despesa',   'DESPESAS FIXAS',       null,                    31),

  -- ── DESPESAS VARIAVEIS ─────────────────────────────────────
  (v_uid, 'DESPESAS VARIAVEIS',                      'grupo',     'DESPESAS VARIAVEIS',   null,                    32),
  (v_uid, 'Ação Comercial',                          'despesa',   'DESPESAS VARIAVEIS',   null,                    33),
  (v_uid, 'Acordo Judicial',                         'despesa',   'DESPESAS VARIAVEIS',   null,                    34),
  (v_uid, 'Cartão Credito Etp',                      'despesa',   'DESPESAS VARIAVEIS',   null,                    35),
  (v_uid, 'Cartão de Debito Etp',                    'despesa',   'DESPESAS VARIAVEIS',   null,                    36),
  (v_uid, 'Confraternização',                        'despesa',   'DESPESAS VARIAVEIS',   null,                    37),
  (v_uid, 'Detetização',                             'despesa',   'DESPESAS VARIAVEIS',   null,                    38),
  (v_uid, 'DEVOLUÇÃO',                               'sub_grupo', 'DESPESAS VARIAVEIS',   'DEVOLUÇÃO',             39),
  (v_uid, 'Devolução Curso',                         'despesa',   'DESPESAS VARIAVEIS',   'DEVOLUÇÃO',             40),
  (v_uid, 'Devolução Matricula x',                   'despesa',   'DESPESAS VARIAVEIS',   'DEVOLUÇÃO',             41),
  (v_uid, 'EXAME FUNCIONARIOS',                      'sub_grupo', 'DESPESAS VARIAVEIS',   'EXAME FUNCIONARIOS',    42),
  (v_uid, 'Exame Admicional',                        'despesa',   'DESPESAS VARIAVEIS',   'EXAME FUNCIONARIOS',    43),
  (v_uid, 'Exame Demicional',                        'despesa',   'DESPESAS VARIAVEIS',   'EXAME FUNCIONARIOS',    44),
  (v_uid, 'Exame Periodico',                         'despesa',   'DESPESAS VARIAVEIS',   'EXAME FUNCIONARIOS',    45),
  (v_uid, 'Financiamento / Consorcio Carro Empresa', 'despesa',   'DESPESAS VARIAVEIS',   null,                    46),
  (v_uid, 'Fórum Técnico',                           'despesa',   'DESPESAS VARIAVEIS',   null,                    47),
  (v_uid, 'Grafica/Brindes/Fardamentos',             'despesa',   'DESPESAS VARIAVEIS',   null,                    48),
  (v_uid, 'Honorarios Advocaticios',                 'despesa',   'DESPESAS VARIAVEIS',   null,                    49),
  (v_uid, 'Indicação de Matrícula',                  'despesa',   'DESPESAS VARIAVEIS',   null,                    50),
  (v_uid, 'Marketing e Propaganda',                  'despesa',   'DESPESAS VARIAVEIS',   null,                    51),
  (v_uid, 'Outros (Despesas Variaveis)',              'despesa',   'DESPESAS VARIAVEIS',   null,                    52),
  (v_uid, 'Plano de Saude Funcionarios',             'despesa',   'DESPESAS VARIAVEIS',   null,                    53),
  (v_uid, 'Rede Social',                             'despesa',   'DESPESAS VARIAVEIS',   null,                    54),
  (v_uid, 'Seguro Estagiarios',                      'despesa',   'DESPESAS VARIAVEIS',   null,                    55),
  (v_uid, 'Sistema Solar',                           'despesa',   'DESPESAS VARIAVEIS',   null,                    56),
  (v_uid, 'Transporte Funcionarios a Serviço',       'despesa',   'DESPESAS VARIAVEIS',   null,                    57),

  -- ── FOLHA DE PAGAMENTO ─────────────────────────────────────
  (v_uid, 'FOLHA DE PAGAMENTO',                      'grupo',     'FOLHA DE PAGAMENTO',   null,                    58),
  (v_uid, 'COMISSÃO/PREMIAÇÃO',                      'sub_grupo', 'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    59),
  (v_uid, 'Comissão Agencia',                        'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    60),
  (v_uid, 'Comissão Cobrança',                       'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    61),
  (v_uid, 'Comissão Comercial',                      'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    62),
  (v_uid, 'Comissao Coordenador(a)',                 'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    63),
  (v_uid, 'Comissão Unopar',                         'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    64),
  (v_uid, 'Premiação Diaria',                        'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    65),
  (v_uid, 'Premiação Meta Batida',                   'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    66),
  (v_uid, 'Premiação Semanal',                       'despesa',   'FOLHA DE PAGAMENTO',   'COMISSÃO/PREMIAÇÃO',    67),
  (v_uid, 'Folha de Precepção Enfermagem',           'sub_grupo', 'FOLHA DE PAGAMENTO',   'Folha de Precepção Enfermagem', 68),
  (v_uid, 'Ajuda de Custo Precepção Enfermagem',     'despesa',   'FOLHA DE PAGAMENTO',   'Folha de Precepção Enfermagem', 69),
  (v_uid, 'Folha de Precepção Radiologia',           'sub_grupo', 'FOLHA DE PAGAMENTO',   'Folha de Precepção Radiologia', 70),
  (v_uid, 'Ajuda de Custo Precepção Radiologia',     'despesa',   'FOLHA DE PAGAMENTO',   'Folha de Precepção Radiologia', 71),
  (v_uid, 'Folha do 13 salario',                     'despesa',   'FOLHA DE PAGAMENTO',   null,                    72),
  (v_uid, 'Folha Estagiários',                       'despesa',   'FOLHA DE PAGAMENTO',   null,                    73),
  (v_uid, 'Folha Funcionários',                      'despesa',   'FOLHA DE PAGAMENTO',   null,                    74),
  (v_uid, 'Folha Professores',                       'sub_grupo', 'FOLHA DE PAGAMENTO',   'Folha Professores',     75),
  (v_uid, 'Ajuda de Custo Professores',              'despesa',   'FOLHA DE PAGAMENTO',   'Folha Professores',     76),
  (v_uid, 'Rescisão Contratual..',                   'despesa',   'FOLHA DE PAGAMENTO',   null,                    77),
  (v_uid, 'Vale Alimentação',                        'despesa',   'FOLHA DE PAGAMENTO',   null,                    78),
  (v_uid, 'Vale Transporte',                         'despesa',   'FOLHA DE PAGAMENTO',   null,                    79),

  -- ── IMPOSTOS ───────────────────────────────────────────────
  (v_uid, 'IMPOSTOS',                                'grupo',     'IMPOSTOS',             null,                    80),
  (v_uid, 'Alteração Empresas',                      'despesa',   'IMPOSTOS',             null,                    81),
  (v_uid, 'Alvará',                                  'despesa',   'IMPOSTOS',             null,                    82),
  (v_uid, 'Bombeiro',                                'despesa',   'IMPOSTOS',             null,                    83),
  (v_uid, 'Fgts',                                    'despesa',   'IMPOSTOS',             null,                    84),
  (v_uid, 'Fgts Rescisão',                           'despesa',   'IMPOSTOS',             null,                    85),
  (v_uid, 'Gps',                                     'despesa',   'IMPOSTOS',             null,                    86),
  (v_uid, 'Imposto de Renda funcionarios',           'despesa',   'IMPOSTOS',             null,                    87),
  (v_uid, 'Imposto/Multa',                           'despesa',   'IMPOSTOS',             null,                    88),
  (v_uid, 'Inss',                                    'despesa',   'IMPOSTOS',             null,                    89),
  (v_uid, 'Iptu',                                    'despesa',   'IMPOSTOS',             null,                    90),
  (v_uid, 'Ipva Carro da escola',                    'despesa',   'IMPOSTOS',             null,                    91),
  (v_uid, 'Iss',                                     'despesa',   'IMPOSTOS',             null,                    92),
  (v_uid, 'Multas Celta',                            'despesa',   'IMPOSTOS',             null,                    93),
  (v_uid, 'Parcelamentos',                           'despesa',   'IMPOSTOS',             null,                    94),
  (v_uid, 'Rais',                                    'despesa',   'IMPOSTOS',             null,                    95),
  (v_uid, 'Simples Nacional',                        'despesa',   'IMPOSTOS',             null,                    96),

  -- ── MANUTENÇÃO ─────────────────────────────────────────────
  (v_uid, 'MANUTENÇÃO',                              'grupo',     'MANUTENÇÃO',           null,                    97),
  (v_uid, 'Aquisição de Equipamentos / Utensílios',  'despesa',   'MANUTENÇÃO',           null,                    98),
  (v_uid, 'Manutenção Ar condicionado',              'despesa',   'MANUTENÇÃO',           null,                    99),
  (v_uid, 'Manutenção Carro',                        'despesa',   'MANUTENÇÃO',           null,                   100),
  (v_uid, 'Manutenção Equipamentos',                 'despesa',   'MANUTENÇÃO',           null,                   101),
  (v_uid, 'Manutenção Predial',                      'despesa',   'MANUTENÇÃO',           null,                   102),
  (v_uid, 'Reforma / Construção',                    'despesa',   'MANUTENÇÃO',           null,                   103),

  -- ── OUTROS ─────────────────────────────────────────────────
  (v_uid, 'OUTROS',                                  'grupo',     'OUTROS',               null,                   104),
  (v_uid, 'Finalizar Declaração',                    'despesa',   'OUTROS',               null,                   105),
  (v_uid, 'Gerar NF Jaboatão',                       'despesa',   'OUTROS',               null,                   106),

  -- ── PRO-LABORE ─────────────────────────────────────────────
  (v_uid, 'PRO-LABORE',                              'grupo',     'PRO-LABORE',           null,                   107),
  (v_uid, 'Agua Mineral (Pessoal)',                  'despesa',   'PRO-LABORE',           null,                   108),
  (v_uid, 'Alimentação (Pessoal)',                   'despesa',   'PRO-LABORE',           null,                   109),
  (v_uid, 'Cartão de Credito Pessoal',               'despesa',   'PRO-LABORE',           null,                   110),
  (v_uid, 'Cartão de Debito Pessoal',                'despesa',   'PRO-LABORE',           null,                   111),
  (v_uid, 'Celpe (Energia Pessoal)',                 'despesa',   'PRO-LABORE',           null,                   112),
  (v_uid, 'Combustivel (Pessoal)',                   'despesa',   'PRO-LABORE',           null,                   113),
  (v_uid, 'Compesa (Água Pessoal)',                  'despesa',   'PRO-LABORE',           null,                   114),
  (v_uid, 'Construção (Pessoal)',                    'despesa',   'PRO-LABORE',           null,                   115),
  (v_uid, 'Doação',                                  'despesa',   'PRO-LABORE',           null,                   116),
  (v_uid, 'Doação (Pessoal)',                        'despesa',   'PRO-LABORE',           null,                   117),
  (v_uid, 'Educação (Pessoal)',                      'despesa',   'PRO-LABORE',           null,                   118),
  (v_uid, 'Entretenimento (Pessoal)',                'despesa',   'PRO-LABORE',           null,                   119),
  (v_uid, 'Feira Semanal (Pessoal)',                 'despesa',   'PRO-LABORE',           null,                   120),
  (v_uid, 'Financiamento/Consorcio Carro (Pessoal)', 'despesa',   'PRO-LABORE',           null,                   121),
  (v_uid, 'Folha Funcionarios (Pessoal)',            'despesa',   'PRO-LABORE',           null,                   122),
  (v_uid, 'Impostos (Pessoal)',                      'despesa',   'PRO-LABORE',           null,                   123),
  (v_uid, 'Lazer (Pessoal)',                         'despesa',   'PRO-LABORE',           null,                   124),
  (v_uid, 'Manutenção/Reforma (Pessoal)',            'despesa',   'PRO-LABORE',           null,                   125),
  (v_uid, 'Outros (Pessoal)',                        'despesa',   'PRO-LABORE',           null,                   126),
  (v_uid, 'Reforma (Pessoal)',                       'despesa',   'PRO-LABORE',           null,                   127),
  (v_uid, 'Retirada (Pessoal)',                      'despesa',   'PRO-LABORE',           null,                   128),
  (v_uid, 'Saúde (Pessoal)',                         'despesa',   'PRO-LABORE',           null,                   129),
  (v_uid, 'Segurança (Pessoal)',                     'despesa',   'PRO-LABORE',           null,                   130),
  (v_uid, 'Seguro Auto / outros (Pessoal)',          'despesa',   'PRO-LABORE',           null,                   131),
  (v_uid, 'Sistema solar (Pessoal)',                 'despesa',   'PRO-LABORE',           null,                   132),
  (v_uid, 'Telefone / Tv por Assinatura (Pessoal)',  'despesa',   'PRO-LABORE',           null,                   133),
  (v_uid, 'Terreno / Imóveis (Pessoal)',             'despesa',   'PRO-LABORE',           null,                   134),
  (v_uid, 'Transporte (Pessoal)',                    'despesa',   'PRO-LABORE',           null,                   135),
  (v_uid, 'Vale Transporte Funcionarios (Pessoal)',  'despesa',   'PRO-LABORE',           null,                   136),
  (v_uid, 'Vestuarios (Pessoal)',                    'despesa',   'PRO-LABORE',           null,                   137),
  (v_uid, 'Viagem (Pessoal)',                        'despesa',   'PRO-LABORE',           null,                   138);

  raise notice 'Reseed plano de contas Gravatá: 138 itens inseridos para unidade_id = %', v_uid;
end $$;
