-- ============================================================
-- ETP Gestão — Tabelas Financeiras
-- Migration: 002_create_financeiro.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- TABELA: etp_categorias_despesas
-- Categorias de despesas por unidade, vindas do Sponte
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_categorias_despesas (
  id              uuid        primary key default gen_random_uuid(),
  unidade_id      uuid        not null references public.etp_unidades(id) on delete cascade,
  categoria_id    integer     not null,          -- ID da categoria no Sponte
  nome            text        not null,
  ativo           boolean     not null default true,
  sincronizado_em timestamptz not null default now(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  -- Unicidade: cada categoria é única por unidade
  constraint uq_cat_unidade unique (unidade_id, categoria_id)
);

create index if not exists idx_etp_cat_desp_unidade   on public.etp_categorias_despesas (unidade_id);
create index if not exists idx_etp_cat_desp_nome       on public.etp_categorias_despesas (nome);

create or replace trigger trg_etp_cat_desp_atualizado_em
  before update on public.etp_categorias_despesas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_categorias_despesas enable row level security;

create policy "Authenticated users can manage categorias_despesas"
  on public.etp_categorias_despesas
  for all
  to authenticated
  using (true)
  with check (true);

comment on table  public.etp_categorias_despesas                   is 'Categorias de despesas por unidade, sincronizadas via API Sponte (GetCategoriasDespesas)';
comment on column public.etp_categorias_despesas.unidade_id        is 'Referência à unidade educacional';
comment on column public.etp_categorias_despesas.categoria_id      is 'ID numérico da categoria no sistema Sponte (CategoriaID)';
comment on column public.etp_categorias_despesas.nome              is 'Nome da categoria de despesa';
comment on column public.etp_categorias_despesas.sincronizado_em   is 'Última vez que a categoria foi sincronizada com a API';


-- ────────────────────────────────────────────────────────────
-- TABELA: etp_contas_pagar
-- Cache das parcelas (pendentes e quitadas) vindas do Sponte
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_contas_pagar (
  id               uuid        primary key default gen_random_uuid(),
  unidade_id       uuid        not null references public.etp_unidades(id) on delete cascade,

  -- Chave natural do Sponte
  conta_pagar_id   integer     not null,    -- ContaPagarID
  numero_parcela   text        not null,    -- NumeroParcela (ex: "01/12")

  -- Dados do lançamento
  sacado           text,                   -- Fornecedor/beneficiário
  categoria        text,                   -- Nome da categoria
  forma_cobranca   text,                   -- Boleto, PIX, etc.
  tipo_recebimento text,

  -- Datas
  vencimento       date,                   -- Data de vencimento
  data_pagamento   date,                   -- Data efetiva de pagamento

  -- Valores
  valor_parcela    numeric(12,2) not null default 0,
  valor_pago       numeric(12,2)           default 0,

  -- Status
  situacao_parcela text        not null default 'Pendente',
                                          -- 'Pendente', 'Quitada', 'Cancelada', etc.

  -- Controle
  sincronizado_em  timestamptz not null default now(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  -- Unicidade: cada parcela é única por unidade
  constraint uq_conta_pagar_unidade unique (unidade_id, conta_pagar_id, numero_parcela)
);

create index if not exists idx_etp_cp_unidade       on public.etp_contas_pagar (unidade_id);
create index if not exists idx_etp_cp_situacao       on public.etp_contas_pagar (situacao_parcela);
create index if not exists idx_etp_cp_vencimento     on public.etp_contas_pagar (vencimento);
create index if not exists idx_etp_cp_data_pagamento on public.etp_contas_pagar (data_pagamento);
create index if not exists idx_etp_cp_categoria      on public.etp_contas_pagar (categoria);
create index if not exists idx_etp_cp_unid_venc      on public.etp_contas_pagar (unidade_id, vencimento);
create index if not exists idx_etp_cp_unid_pag       on public.etp_contas_pagar (unidade_id, data_pagamento);

create or replace trigger trg_etp_cp_atualizado_em
  before update on public.etp_contas_pagar
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_contas_pagar enable row level security;

create policy "Authenticated users can manage contas_pagar"
  on public.etp_contas_pagar
  for all
  to authenticated
  using (true)
  with check (true);

comment on table  public.etp_contas_pagar                      is 'Cache de contas a pagar (pendentes e quitadas) sincronizadas via API Sponte (GetParcelasPagar)';
comment on column public.etp_contas_pagar.unidade_id           is 'Referência à unidade educacional';
comment on column public.etp_contas_pagar.conta_pagar_id       is 'ID da conta no Sponte (ContaPagarID)';
comment on column public.etp_contas_pagar.numero_parcela       is 'Número da parcela no formato NN/NN';
comment on column public.etp_contas_pagar.sacado               is 'Nome do fornecedor / beneficiário';
comment on column public.etp_contas_pagar.categoria            is 'Categoria de despesa do lançamento';
comment on column public.etp_contas_pagar.vencimento           is 'Data de vencimento da parcela';
comment on column public.etp_contas_pagar.data_pagamento       is 'Data efetiva de pagamento (null = pendente)';
comment on column public.etp_contas_pagar.valor_parcela        is 'Valor nominal da parcela';
comment on column public.etp_contas_pagar.valor_pago           is 'Valor efetivamente pago (pode diferir por juros/desconto)';
comment on column public.etp_contas_pagar.situacao_parcela     is 'Situação atual: Pendente, Quitada, Cancelada, etc.';
comment on column public.etp_contas_pagar.sincronizado_em      is 'Última sincronização com a API Sponte';


-- ────────────────────────────────────────────────────────────
-- TABELA: etp_sync_log
-- Histórico de sincronizações com a API Sponte
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_sync_log (
  id                uuid        primary key default gen_random_uuid(),
  unidade_id        uuid        references public.etp_unidades(id) on delete set null,
  tipo_sync         text        not null,    -- 'contas_pagar_pendentes', 'contas_pagar_pagas', 'categorias'
  data_inicio       date,
  data_fim          date,
  total_registros   integer     default 0,
  status            text        not null default 'sucesso',  -- 'sucesso', 'erro', 'parcial'
  mensagem_erro     text,
  iniciado_em       timestamptz not null default now(),
  concluido_em      timestamptz
);

create index if not exists idx_etp_sync_log_unidade on public.etp_sync_log (unidade_id);
create index if not exists idx_etp_sync_log_tipo    on public.etp_sync_log (tipo_sync);

alter table public.etp_sync_log enable row level security;

create policy "Authenticated users can manage sync_log"
  on public.etp_sync_log
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.etp_sync_log is 'Log de sincronizações realizadas com a API Sponte para auditoria e controle';


-- ────────────────────────────────────────────────────────────
-- VIEW: vw_etp_resumo_mensal
-- Resumo financeiro mensal por unidade (para gráficos)
-- ────────────────────────────────────────────────────────────
create or replace view public.vw_etp_resumo_mensal as
select
  u.id                                           as unidade_id,
  u.nome                                         as unidade_nome,
  u.cor                                          as unidade_cor,
  date_trunc('month', cp.data_pagamento)         as mes_pagamento,
  date_trunc('month', cp.vencimento)             as mes_vencimento,
  cp.situacao_parcela,
  cp.categoria,
  count(*)                                       as qtd_parcelas,
  sum(cp.valor_parcela)                          as total_valor_parcela,
  sum(coalesce(cp.valor_pago, 0))                as total_valor_pago
from public.etp_contas_pagar cp
join public.etp_unidades u on u.id = cp.unidade_id
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.vw_etp_resumo_mensal is 'Resumo financeiro mensal agregado por unidade, situação e categoria';
