-- ============================================================
-- ETP Gestão — Plano de Contas (substitui Categorias de Despesas)
-- Migration: 004_plano_contas.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Remove tabela antiga de categorias planas
-- ────────────────────────────────────────────────────────────
drop table if exists public.etp_categorias_despesas cascade;

-- ────────────────────────────────────────────────────────────
-- 2. TABELA: etp_plano_contas
--    Estrutura hierárquica: Grupo > Sub-Grupo > Despesa
--    Cada unidade tem seu próprio plano de contas.
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_plano_contas (
  id              uuid        primary key default gen_random_uuid(),
  unidade_id      uuid        not null references public.etp_unidades(id) on delete cascade,

  -- Dados do Sponte (nullable para itens seeded manualmente)
  sponte_id       integer,

  -- Nome da entrada sem sufixos como "(*)";
  -- é o mesmo texto que aparece no campo "categoria" das contas a pagar
  nome            text        not null,

  -- Nível hierárquico
  tipo            text        not null check (tipo in ('grupo', 'sub_grupo', 'despesa')),

  -- Desnormalização para facilitar agregações sem JOIN recursivo
  grupo_nome      text,        -- nome do grupo pai (igual a nome quando tipo='grupo')
  sub_grupo_nome  text,        -- nome do sub-grupo pai (null quando despesa direta do grupo)

  ativo           boolean     not null default true,
  sincronizado_em timestamptz not null default now(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  -- Unicidade: nome único por unidade
  constraint uq_plano_contas_unidade_nome unique (unidade_id, nome)
);

create index if not exists idx_etp_pc_unidade  on public.etp_plano_contas (unidade_id);
create index if not exists idx_etp_pc_tipo     on public.etp_plano_contas (tipo);
create index if not exists idx_etp_pc_grupo    on public.etp_plano_contas (grupo_nome);

create or replace trigger trg_etp_pc_atualizado_em
  before update on public.etp_plano_contas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_plano_contas enable row level security;

create policy "Authenticated users can manage plano_contas"
  on public.etp_plano_contas for all to authenticated
  using (true) with check (true);

create policy "Anon users can manage plano_contas"
  on public.etp_plano_contas for all to anon
  using (true) with check (true);

comment on table  public.etp_plano_contas is 'Plano de contas hierárquico por unidade (Grupo > Sub-Grupo > Despesa), sincronizado via API Sponte';
comment on column public.etp_plano_contas.sponte_id      is 'CategoriaID no Sponte (null = item seeded manualmente)';
comment on column public.etp_plano_contas.nome           is 'Nome da entrada — deve coincidir com etp_contas_pagar.categoria para o mapeamento funcionar';
comment on column public.etp_plano_contas.tipo           is 'Nível: grupo (raiz), sub_grupo (intermediário), despesa (folha)';
comment on column public.etp_plano_contas.grupo_nome     is 'Nome do grupo pai — usado em agregações do dashboard e planejamento';
comment on column public.etp_plano_contas.sub_grupo_nome is 'Nome do sub-grupo pai (null quando despesa direta de um grupo)';


-- ────────────────────────────────────────────────────────────
-- 3. Adapta etp_planejamento: categoria → grupo
-- ────────────────────────────────────────────────────────────
do $$
begin
  -- Renomeia a coluna se ainda não foi renomeada
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'etp_planejamento'
      and column_name  = 'categoria'
  ) then
    alter table public.etp_planejamento rename column categoria to grupo;
  end if;
end $$;

-- Atualiza constraint de unicidade (drop + recreate)
alter table public.etp_planejamento
  drop constraint if exists uq_planejamento_unidade_mes_cat;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_planejamento_unidade_mes_grupo'
  ) then
    alter table public.etp_planejamento
      add constraint uq_planejamento_unidade_mes_grupo
      unique (unidade_id, mes_referencia, grupo);
  end if;
end $$;

comment on column public.etp_planejamento.grupo is 'Nome do grupo de despesa planejado (corresponde a etp_plano_contas.grupo_nome)';


-- ────────────────────────────────────────────────────────────
-- 4. Seed: Plano de Contas da Unidade Gravatá
--    Executa apenas se a unidade existir no banco.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_uid uuid;
begin
  select id into v_uid
  from public.etp_unidades
  where nome ilike '%gravat%'
  limit 1;

  if v_uid is null then
    raise notice 'Seed plano de contas: unidade Gravatá não encontrada, seed ignorado.';
    return;
  end if;

  insert into public.etp_plano_contas (unidade_id, nome, tipo, grupo_nome, sub_grupo_nome) values
  -- ── DESPESAS BANCARIAS ──────────────────────────────────
  (v_uid, 'DESPESAS BANCARIAS',            'grupo',    'DESPESAS BANCARIAS', null),
  (v_uid, 'Emprestimos',                   'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Iof',                           'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Juros',                         'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Tarifas Bancarias',             'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Tarifas Boleto',                'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Taxa Adm Cartão',               'despesa',  'DESPESAS BANCARIAS', null),
  (v_uid, 'Taxa de Antecipação',           'despesa',  'DESPESAS BANCARIAS', null),

  -- ── DESPESAS FIXAS ──────────────────────────────────────
  (v_uid, 'DESPESAS FIXAS',                'grupo',    'DESPESAS FIXAS', null),
  (v_uid, 'Agua Mineral',                  'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Aluguel Predial',               'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Associação / Sindicatos',       'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Celpe (energia)',               'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Coleta de Lixo',               'despesa',  'DESPESAS FIXAS', null),
  -- sub-grupo
  (v_uid, 'COMBUSTIVEL VEICULOS',          'sub_grupo','DESPESAS FIXAS', 'COMBUSTIVEL VEICULOS'),
  (v_uid, 'Combustivel Celta',             'despesa',  'DESPESAS FIXAS', 'COMBUSTIVEL VEICULOS'),
  (v_uid, 'Combustivel Celta Professores', 'despesa',  'DESPESAS FIXAS', 'COMBUSTIVEL VEICULOS'),
  (v_uid, 'Combustivel Deslocamento Funcionarios','despesa','DESPESAS FIXAS','COMBUSTIVEL VEICULOS'),
  -- continua despesas diretas
  (v_uid, 'Compesa (Água)',                'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Consultorias / Treinamento',    'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Contador',                      'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Elaboração Apostilhas',         'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Material Apostilha',            'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Material de aula pratica',      'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Material de aula pratica (Curso Extra)','despesa','DESPESAS FIXAS',null),
  (v_uid, 'Material de Expediente',        'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Material Limpeza',              'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Segurança',                     'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Seguro Auto / Outros',          'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Sistema / Automação',           'despesa',  'DESPESAS FIXAS', null),
  (v_uid, 'Telefone/Movel/Internet',       'despesa',  'DESPESAS FIXAS', null),

  -- ── DESPESAS VARIAVEIS ──────────────────────────────────
  (v_uid, 'DESPESAS VARIAVEIS',            'grupo',    'DESPESAS VARIAVEIS', null),
  (v_uid, 'Ação Comercial',                'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Acordo Judicial',               'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Cartão Credito Etp',            'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Cartão de Debito Etp',          'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Confraternização',              'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Detetização',                   'despesa',  'DESPESAS VARIAVEIS', null),
  -- sub-grupo
  (v_uid, 'DEVOLUÇÃO',                     'sub_grupo','DESPESAS VARIAVEIS', 'DEVOLUÇÃO'),
  (v_uid, 'Devolução Curso',               'despesa',  'DESPESAS VARIAVEIS', 'DEVOLUÇÃO'),
  (v_uid, 'Devolução Matricula x',         'despesa',  'DESPESAS VARIAVEIS', 'DEVOLUÇÃO'),
  -- sub-grupo
  (v_uid, 'EXAME FUNCIONARIOS',            'sub_grupo','DESPESAS VARIAVEIS', 'EXAME FUNCIONARIOS'),
  (v_uid, 'Exame Admicional',              'despesa',  'DESPESAS VARIAVEIS', 'EXAME FUNCIONARIOS'),
  (v_uid, 'Exame Demicional',              'despesa',  'DESPESAS VARIAVEIS', 'EXAME FUNCIONARIOS'),
  (v_uid, 'Exame Periodico',               'despesa',  'DESPESAS VARIAVEIS', 'EXAME FUNCIONARIOS'),
  -- continua despesas diretas
  (v_uid, 'Financiamento r Consorcio Carro Empresa','despesa','DESPESAS VARIAVEIS',null),
  (v_uid, 'Fórum Técnico',                 'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Grafica/Brindes/Fardamentos',   'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Honorarios Advocaticios',       'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Indicação de Matrícula',        'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Marketing e Propaganda',        'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Outros (Despesas Variaveis)',   'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Plano de Saude Funcionarios',   'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Rede Social',                   'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Seguro Estagiarios',            'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Sistema Solar',                 'despesa',  'DESPESAS VARIAVEIS', null),
  (v_uid, 'Transporte Funcionarios a Serviço','despesa','DESPESAS VARIAVEIS',null),

  -- ── FOLHA DE PAGAMENTO ──────────────────────────────────
  (v_uid, 'FOLHA DE PAGAMENTO',            'grupo',    'FOLHA DE PAGAMENTO', null),
  -- sub-grupo
  (v_uid, 'COMISSÃO/PREMIAÇÃO',            'sub_grupo','FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Comissão Agencia',              'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Comissão Cobrança',             'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Comissão Comercial',            'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Comissão Coordenador(a)',       'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Comissão Unopar',               'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Premiação Diaria',              'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Premiação Meta Batida',         'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  (v_uid, 'Premiação Semanal',             'despesa',  'FOLHA DE PAGAMENTO', 'COMISSÃO/PREMIAÇÃO'),
  -- sub-grupo (mixed-case com filhos)
  (v_uid, 'Folha de Precepção Enfermagem', 'sub_grupo','FOLHA DE PAGAMENTO', 'Folha de Precepção Enfermagem'),
  (v_uid, 'Ajuda de Custo Precepção Enfermagem','despesa','FOLHA DE PAGAMENTO','Folha de Precepção Enfermagem'),
  -- sub-grupo
  (v_uid, 'Folha de Precepção Radiologia', 'sub_grupo','FOLHA DE PAGAMENTO', 'Folha de Precepção Radiologia'),
  (v_uid, 'Ajuda de Custo Precepção Radiologia','despesa','FOLHA DE PAGAMENTO','Folha de Precepção Radiologia'),
  -- despesas diretas
  (v_uid, 'Folha do 13 salario',           'despesa',  'FOLHA DE PAGAMENTO', null),
  (v_uid, 'Folha Estagiários',             'despesa',  'FOLHA DE PAGAMENTO', null),
  (v_uid, 'Folha Funcionários',            'despesa',  'FOLHA DE PAGAMENTO', null),
  -- sub-grupo
  (v_uid, 'Folha Professores',             'sub_grupo','FOLHA DE PAGAMENTO', 'Folha Professores'),
  (v_uid, 'Ajuda de Custo Professores',    'despesa',  'FOLHA DE PAGAMENTO', 'Folha Professores'),
  -- despesas diretas
  (v_uid, 'Rescisão Contratual..',         'despesa',  'FOLHA DE PAGAMENTO', null),
  (v_uid, 'Vale Alimentação',              'despesa',  'FOLHA DE PAGAMENTO', null),
  (v_uid, 'Vale Transporte',               'despesa',  'FOLHA DE PAGAMENTO', null),

  -- ── IMPOSTOS ────────────────────────────────────────────
  (v_uid, 'IMPOSTOS',                      'grupo',    'IMPOSTOS', null),
  (v_uid, 'Alteração Empresas',            'despesa',  'IMPOSTOS', null),
  (v_uid, 'Alvará',                        'despesa',  'IMPOSTOS', null),
  (v_uid, 'Bombeiro',                      'despesa',  'IMPOSTOS', null),
  (v_uid, 'Fgts',                          'despesa',  'IMPOSTOS', null),
  (v_uid, 'Fgts Rescisão',                 'despesa',  'IMPOSTOS', null),
  (v_uid, 'Gps',                           'despesa',  'IMPOSTOS', null),
  (v_uid, 'Imposto de Renda funcionarios', 'despesa',  'IMPOSTOS', null),
  (v_uid, 'Imposto/Multa',                 'despesa',  'IMPOSTOS', null),
  (v_uid, 'Inss',                          'despesa',  'IMPOSTOS', null),
  (v_uid, 'Iptu',                          'despesa',  'IMPOSTOS', null),
  (v_uid, 'Ipva Carro da escola',          'despesa',  'IMPOSTOS', null),
  (v_uid, 'Iss',                           'despesa',  'IMPOSTOS', null),
  (v_uid, 'Multas Celta',                  'despesa',  'IMPOSTOS', null),
  (v_uid, 'Parcelamentos',                 'despesa',  'IMPOSTOS', null),
  (v_uid, 'Rais',                          'despesa',  'IMPOSTOS', null),
  (v_uid, 'Simples Nacional',              'despesa',  'IMPOSTOS', null),

  -- ── MANUTENÇÃO ──────────────────────────────────────────
  (v_uid, 'MANUTENÇÃO',                    'grupo',    'MANUTENÇÃO', null),
  (v_uid, 'Aquisição de Equipamentos / Utensílios','despesa','MANUTENÇÃO',null),
  (v_uid, 'Manutenção Ar condicionado',    'despesa',  'MANUTENÇÃO', null),
  (v_uid, 'Manutenção Carro',              'despesa',  'MANUTENÇÃO', null),
  (v_uid, 'Manutenção Equipamentos',       'despesa',  'MANUTENÇÃO', null),
  (v_uid, 'Manutenção Predial',            'despesa',  'MANUTENÇÃO', null),
  (v_uid, 'Reforma / Construção',          'despesa',  'MANUTENÇÃO', null),

  -- ── OUTROS ──────────────────────────────────────────────
  (v_uid, 'OUTROS',                        'grupo',    'OUTROS', null),
  (v_uid, 'Finalizar Declaração',          'despesa',  'OUTROS', null),
  (v_uid, 'Gerar NF Jaboatão',             'despesa',  'OUTROS', null),

  -- ── PRO-LABORE ──────────────────────────────────────────
  (v_uid, 'PRO-LABORE',                    'grupo',    'PRO-LABORE', null),
  (v_uid, 'Agua Mineral (Pessoal)',         'despesa',  'PRO-LABORE', null),
  (v_uid, 'Alimentação (Pessoal)',          'despesa',  'PRO-LABORE', null),
  (v_uid, 'Cartão de Credito Pessoal',      'despesa',  'PRO-LABORE', null),
  (v_uid, 'Cartão de Debito Pessoal',       'despesa',  'PRO-LABORE', null),
  (v_uid, 'Celpe (Energia Pessoal)',        'despesa',  'PRO-LABORE', null),
  (v_uid, 'Combustivel (Pessoal)',          'despesa',  'PRO-LABORE', null),
  (v_uid, 'Compesa (Agua Pessoal)',         'despesa',  'PRO-LABORE', null),
  (v_uid, 'Construção (Pessoal)',           'despesa',  'PRO-LABORE', null),
  (v_uid, 'Doação',                        'despesa',  'PRO-LABORE', null),
  (v_uid, 'Doação (Pessoal)',              'despesa',  'PRO-LABORE', null),
  (v_uid, 'Educação (Pessoal)',             'despesa',  'PRO-LABORE', null),
  (v_uid, 'Entretenimento (Pessoal)',       'despesa',  'PRO-LABORE', null),
  (v_uid, 'Feira Semanal (Pessoal)',        'despesa',  'PRO-LABORE', null),
  (v_uid, 'Financiamento/Consorcio Carro (Pessoal)','despesa','PRO-LABORE',null),
  (v_uid, 'Folha Funcionarios (Pessoal)',   'despesa',  'PRO-LABORE', null),
  (v_uid, 'Impostos (Pessoal)',             'despesa',  'PRO-LABORE', null),
  (v_uid, 'Lazer (Pessoal)',                'despesa',  'PRO-LABORE', null),
  (v_uid, 'Manutenção/Reforma (Pessoal)',   'despesa',  'PRO-LABORE', null),
  (v_uid, 'Outros (Pessoal)',               'despesa',  'PRO-LABORE', null),
  (v_uid, 'Reforma (Pessoal)',              'despesa',  'PRO-LABORE', null),
  (v_uid, 'Retirada (Pessoal)',             'despesa',  'PRO-LABORE', null),
  (v_uid, 'Saúde (Pessoal)',                'despesa',  'PRO-LABORE', null),
  (v_uid, 'Segurança (Pessoal)',            'despesa',  'PRO-LABORE', null),
  (v_uid, 'Seguro Auto / outros (Pessoal)', 'despesa',  'PRO-LABORE', null),
  (v_uid, 'Sistema solar (Pessoal)',        'despesa',  'PRO-LABORE', null),
  (v_uid, 'Telefone / Tv por Assinatura (Pessoal)','despesa','PRO-LABORE',null),
  (v_uid, 'Terreno / Imóveis (Pessoal)',    'despesa',  'PRO-LABORE', null),
  (v_uid, 'Transporte (Pessoal)',           'despesa',  'PRO-LABORE', null),
  (v_uid, 'Vale Transporte Funcionarios (Pessoal)','despesa','PRO-LABORE',null),
  (v_uid, 'Vestuarios (Pessoal)',           'despesa',  'PRO-LABORE', null),
  (v_uid, 'Viagem (Pessoal)',               'despesa',  'PRO-LABORE', null)

  on conflict (unidade_id, nome) do nothing;

  raise notice 'Seed plano de contas Gravatá: concluído para unidade_id = %', v_uid;
end $$;
