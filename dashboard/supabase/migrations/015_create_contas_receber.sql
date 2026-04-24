-- ============================================================
-- ETP Gestao — Contas a Receber (Mensalidades)
-- Migration: 015_create_contas_receber.sql
--
-- Espelha o modelo de contas a pagar (migration 002) para
-- receitas/mensalidades vindas da API Sponte:
--   - GetCategorias        -> etp_categorias_receitas
--   - GetParcelas (wsParcela) -> etp_contas_receber
--
-- Pre-requisitos:
--   - Funcao public.set_atualizado_em() (criada em 001)
--   - Funcoes public.user_has_access_to_unidade(uuid) e
--     public.user_has_role_min(text) (criadas em 012)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- TABELA: etp_categorias_receitas
-- Categorias de receitas por unidade, vindas do Sponte
-- (endpoint GetCategorias, schema wsCategorias -> Categorias)
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_categorias_receitas (
  id              uuid        primary key default gen_random_uuid(),
  unidade_id      uuid        not null references public.etp_unidades(id) on delete cascade,
  categoria_id    integer     not null,          -- ID da categoria no Sponte
  nome            text        not null,
  ativo           boolean     not null default true,
  sincronizado_em timestamptz not null default now(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  -- Unicidade: cada categoria e unica por unidade
  constraint uq_cat_rec_unidade unique (unidade_id, categoria_id)
);

create index if not exists idx_etp_cat_rec_unidade on public.etp_categorias_receitas (unidade_id);
create index if not exists idx_etp_cat_rec_nome    on public.etp_categorias_receitas (nome);

create or replace trigger trg_etp_cat_rec_atualizado_em
  before update on public.etp_categorias_receitas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_categorias_receitas enable row level security;

-- RLS: leitura por qualquer usuario com acesso a unidade
create policy "Users can view categorias_receitas of their empresa"
  on public.etp_categorias_receitas
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

-- RLS: escrita restrita a admin+
create policy "Admins can manage categorias_receitas"
  on public.etp_categorias_receitas
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  );

-- RLS: service_role tem acesso total (sync jobs)
create policy "Service role manages categorias_receitas"
  on public.etp_categorias_receitas
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.etp_categorias_receitas from anon;

comment on table  public.etp_categorias_receitas                 is 'Categorias de receitas por unidade, sincronizadas via API Sponte (GetCategorias)';
comment on column public.etp_categorias_receitas.unidade_id      is 'Referencia a unidade educacional';
comment on column public.etp_categorias_receitas.categoria_id    is 'ID numerico da categoria no sistema Sponte (CategoriaID)';
comment on column public.etp_categorias_receitas.nome            is 'Nome da categoria de receita (ex: Mensalidade, Matricula)';
comment on column public.etp_categorias_receitas.sincronizado_em is 'Ultima vez que a categoria foi sincronizada com a API';


-- ────────────────────────────────────────────────────────────
-- TABELA: etp_contas_receber
-- Cache das parcelas a receber (pendentes e recebidas) do Sponte
-- (endpoint GetParcelas, schema wsParcela)
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_contas_receber (
  id                uuid        primary key default gen_random_uuid(),
  unidade_id        uuid        not null references public.etp_unidades(id) on delete cascade,

  -- Chave natural do Sponte
  conta_receber_id  integer     not null,     -- ContaReceberID
  numero_parcela    text        not null,     -- NumeroParcela (ex: "01/12")

  -- Dados do lancamento
  sacado            text,                    -- Nome do responsavel/aluno
  aluno_id          integer,                 -- AlunoID (chave estavel do aluno no Sponte)
  categoria         text,                    -- Nome da categoria (ex: Mensalidade)
  forma_cobranca    text,                    -- Boleto, PIX, etc.
  tipo_recebimento  text,
  bolsa_associada   text,                    -- BolsaAssociada (descricao da bolsa aplicada)

  -- Identificadores bancarios/fatura
  numero_boleto     bigint,                  -- NumeroBoleto
  fatura_id         bigint,                  -- FaturaID
  conta_id          integer,                 -- ContaID

  -- Datas
  vencimento        date,                    -- Data de vencimento da parcela
  data_pagamento    date,                    -- Data efetiva de recebimento

  -- Valores
  valor_parcela     numeric(12,2) not null default 0,
  valor_pago        numeric(12,2)           default 0,

  -- Status
  situacao_parcela  text        not null default 'A Receber',
                                             -- 'A Receber', 'Recebida', 'Vencida', 'Cancelada', etc.
  situacao_cnab     text,                    -- SituacaoCNAB (status de retorno bancario)

  -- Controle
  sincronizado_em   timestamptz not null default now(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),

  -- Unicidade: cada parcela e unica por unidade
  constraint uq_conta_receber_unidade unique (unidade_id, conta_receber_id, numero_parcela)
);

create index if not exists idx_etp_cr_unidade       on public.etp_contas_receber (unidade_id);
create index if not exists idx_etp_cr_situacao      on public.etp_contas_receber (situacao_parcela);
create index if not exists idx_etp_cr_vencimento    on public.etp_contas_receber (vencimento);
create index if not exists idx_etp_cr_data_pagamento on public.etp_contas_receber (data_pagamento);
create index if not exists idx_etp_cr_categoria     on public.etp_contas_receber (categoria);
create index if not exists idx_etp_cr_unid_venc     on public.etp_contas_receber (unidade_id, vencimento);
create index if not exists idx_etp_cr_unid_pag      on public.etp_contas_receber (unidade_id, data_pagamento);
create index if not exists idx_etp_cr_aluno         on public.etp_contas_receber (aluno_id);

create or replace trigger trg_etp_cr_atualizado_em
  before update on public.etp_contas_receber
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_contas_receber enable row level security;

-- RLS: leitura por qualquer usuario com acesso a unidade
create policy "Users can view contas_receber of their empresa"
  on public.etp_contas_receber
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

-- RLS: escrita restrita a admin+
create policy "Admins can manage contas_receber"
  on public.etp_contas_receber
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  );

-- RLS: service_role tem acesso total (sync jobs)
create policy "Service role manages contas_receber"
  on public.etp_contas_receber
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.etp_contas_receber from anon;

comment on table  public.etp_contas_receber                   is 'Cache de contas a receber (mensalidades) sincronizadas via API Sponte (GetParcelas)';
comment on column public.etp_contas_receber.unidade_id        is 'Referencia a unidade educacional';
comment on column public.etp_contas_receber.conta_receber_id  is 'ID da conta no Sponte (ContaReceberID)';
comment on column public.etp_contas_receber.numero_parcela    is 'Numero da parcela no formato NN/NN';
comment on column public.etp_contas_receber.sacado            is 'Nome do responsavel/aluno';
comment on column public.etp_contas_receber.aluno_id          is 'AlunoID no Sponte (chave estavel para joins)';
comment on column public.etp_contas_receber.categoria         is 'Categoria de receita do lancamento (Mensalidade, Matricula, etc.)';
comment on column public.etp_contas_receber.bolsa_associada   is 'Descricao da bolsa aplicada na parcela, se houver';
comment on column public.etp_contas_receber.numero_boleto     is 'Numero do boleto emitido';
comment on column public.etp_contas_receber.fatura_id         is 'FaturaID agrupadora no Sponte';
comment on column public.etp_contas_receber.vencimento        is 'Data de vencimento da parcela';
comment on column public.etp_contas_receber.data_pagamento    is 'Data efetiva de recebimento (null = em aberto)';
comment on column public.etp_contas_receber.valor_parcela     is 'Valor nominal da parcela';
comment on column public.etp_contas_receber.valor_pago        is 'Valor efetivamente recebido (pode diferir por juros/desconto/bolsa)';
comment on column public.etp_contas_receber.situacao_parcela  is 'Situacao atual: A Receber, Recebida, Vencida, Cancelada, etc.';
comment on column public.etp_contas_receber.situacao_cnab     is 'Status do retorno bancario (CNAB)';
comment on column public.etp_contas_receber.sincronizado_em   is 'Ultima sincronizacao com a API Sponte';


-- ────────────────────────────────────────────────────────────
-- VIEW: vw_etp_resumo_mensal_receber
-- Resumo financeiro mensal por unidade (para graficos)
-- Espelha vw_etp_resumo_mensal de CP, sobre contas a receber
-- ────────────────────────────────────────────────────────────
create or replace view public.vw_etp_resumo_mensal_receber as
select
  u.id                                            as unidade_id,
  u.nome                                          as unidade_nome,
  u.cor                                           as unidade_cor,
  date_trunc('month', cr.data_pagamento)          as mes_recebimento,
  date_trunc('month', cr.vencimento)              as mes_vencimento,
  cr.situacao_parcela,
  cr.categoria,
  count(*)                                        as qtd_parcelas,
  sum(cr.valor_parcela)                           as total_valor_parcela,
  sum(coalesce(cr.valor_pago, 0))                 as total_valor_recebido
from public.etp_contas_receber cr
join public.etp_unidades u on u.id = cr.unidade_id
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.vw_etp_resumo_mensal_receber is 'Resumo financeiro mensal de contas a receber, agregado por unidade, situacao e categoria';
