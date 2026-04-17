-- ============================================================
-- ETP Gestao — Controle de Sincronizacao por Dia/Unidade
-- Migration: 007_create_sync_dias.sql
--
-- Tabela multi-tenant que registra cada dia sincronizado por
-- unidade educacional. Usada para exibir o mapa de cobertura
-- de sincronizacao na tela Configuracoes > Sincronizar.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- TABELA: etp_sync_dias
-- Uma linha por dia/unidade sincronizado com sucesso
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_sync_dias (
  id              uuid        primary key default gen_random_uuid(),
  unidade_id      uuid        not null references public.etp_unidades(id) on delete cascade,

  -- Dia que foi sincronizado (a data de pagamento consultada na API)
  data            date        not null,

  -- Quantos registros foram retornados/salvos nesse dia
  registros       integer     not null default 0,

  -- Controle
  sincronizado_em timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  -- Unicidade: cada dia e unico por unidade
  constraint uq_sync_dia_unidade unique (unidade_id, data)
);

-- Indices
create index if not exists idx_etp_sync_dias_unidade on public.etp_sync_dias (unidade_id);
create index if not exists idx_etp_sync_dias_data    on public.etp_sync_dias (data);
create index if not exists idx_etp_sync_dias_unid_data on public.etp_sync_dias (unidade_id, data);

-- Trigger de atualizacao
create or replace trigger trg_etp_sync_dias_atualizado_em
  before update on public.etp_sync_dias
  for each row execute procedure public.set_atualizado_em();

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table public.etp_sync_dias enable row level security;

-- Usuarios autenticados veem apenas dias de suas unidades
create policy "Users can view sync_dias of their units"
  on public.etp_sync_dias
  for select
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  );

-- Usuarios autenticados podem gerenciar dias de suas unidades
create policy "Users can manage sync_dias of their units"
  on public.etp_sync_dias
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
  );

-- Service role tem acesso total
create policy "Service role manages sync_dias"
  on public.etp_sync_dias
  for all
  to service_role
  using (true)
  with check (true);

-- ────────────────────────────────────────────────────────────
-- Comentarios
-- ────────────────────────────────────────────────────────────
comment on table  public.etp_sync_dias                    is 'Controle de sincronizacao por dia/unidade. Cada linha indica que o dia foi consultado na API Sponte.';
comment on column public.etp_sync_dias.unidade_id         is 'Referencia a unidade educacional';
comment on column public.etp_sync_dias.data               is 'Data (dia) que foi sincronizada com a API';
comment on column public.etp_sync_dias.registros          is 'Quantidade de registros retornados/salvos nesse dia';
comment on column public.etp_sync_dias.sincronizado_em    is 'Momento da ultima sincronizacao desse dia';
comment on column public.etp_sync_dias.atualizado_em      is 'Ultima atualizacao do registro';
