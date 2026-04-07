-- ============================================================
-- ETP Gestão — Módulo de Planejamento
-- Migration: 003_create_planejamento.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- TABELA: etp_planejamento
-- Planejamento financeiro mensal por unidade e categoria
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_planejamento (
  id            uuid          primary key default gen_random_uuid(),
  unidade_id    uuid          not null references public.etp_unidades(id) on delete cascade,

  -- Mês/Ano do planejamento (primeiro dia do mês)
  mes_referencia date          not null,   -- ex: 2026-03-01

  -- Categoria de despesa
  categoria     text          not null,

  -- Valor planejado
  valor_planejado numeric(12,2) not null default 0,

  -- Observação opcional
  observacao    text,

  -- Controle
  criado_em     timestamptz   not null default now(),
  atualizado_em timestamptz   not null default now(),

  -- Unicidade: cada categoria é única por unidade/mês
  constraint uq_planejamento_unidade_mes_cat unique (unidade_id, mes_referencia, categoria)
);

create index if not exists idx_etp_plan_unidade   on public.etp_planejamento (unidade_id);
create index if not exists idx_etp_plan_mes        on public.etp_planejamento (mes_referencia);
create index if not exists idx_etp_plan_unid_mes   on public.etp_planejamento (unidade_id, mes_referencia);

create or replace trigger trg_etp_plan_atualizado_em
  before update on public.etp_planejamento
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_planejamento enable row level security;

create policy "Authenticated users can manage planejamento"
  on public.etp_planejamento
  for all
  to authenticated
  using (true)
  with check (true);

-- Permite anon também (sem auth configurado no projeto)
create policy "Anon users can manage planejamento"
  on public.etp_planejamento
  for all
  to anon
  using (true)
  with check (true);

comment on table  public.etp_planejamento                        is 'Planejamento financeiro mensal por unidade e categoria de despesa';
comment on column public.etp_planejamento.unidade_id            is 'Referência à unidade educacional';
comment on column public.etp_planejamento.mes_referencia        is 'Primeiro dia do mês planejado (ex: 2026-03-01)';
comment on column public.etp_planejamento.categoria             is 'Nome da categoria de despesa planejada';
comment on column public.etp_planejamento.valor_planejado       is 'Valor previsto/orçado para o mês';
comment on column public.etp_planejamento.observacao            is 'Observação livre sobre o planejamento desta categoria';
