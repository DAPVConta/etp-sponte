-- ============================================================
-- ETP Gestao — Vinculo de Usuarios a Empresas
-- Migration: 011_create_user_empresas.sql
--
-- Cria a tabela etp_user_empresas que vincula auth.uid() a uma
-- empresa com um role especifico.
--
-- Roles:
--   admin  — gerencia a empresa: unidades, usuarios, sincronizacao
--   editor — edita planejamento, ve dados financeiros
--   viewer — somente leitura
--
-- super_admin e armazenado em auth.users.raw_user_meta_data:
--   { "role": "super_admin" }
-- Isso permite acesso cross-empresa sem estar vinculado a nenhuma.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Remove tabela antiga etp_user_unidades (substituida por esta)
-- ────────────────────────────────────────────────────────────
drop table if exists public.etp_user_unidades cascade;

-- ────────────────────────────────────────────────────────────
-- TABELA: etp_user_empresas
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_user_empresas (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,                                       -- auth.uid()
  empresa_id  uuid        not null references public.etp_empresas(id) on delete cascade,
  role        text        not null default 'viewer'
                          check (role in ('admin', 'editor', 'viewer')),
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint uq_user_empresa unique (user_id, empresa_id)
);

create index if not exists idx_etp_ue_user    on public.etp_user_empresas (user_id);
create index if not exists idx_etp_ue_empresa on public.etp_user_empresas (empresa_id);

create or replace trigger trg_etp_ue_atualizado_em
  before update on public.etp_user_empresas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_user_empresas enable row level security;

-- Usuarios veem apenas seus proprios vinculos
create policy "Users see own empresa associations"
  on public.etp_user_empresas
  for select
  to authenticated
  using (user_id = auth.uid());

-- Service role gerencia tudo (usado pelas funcoes de admin)
create policy "Service role manages user_empresas"
  on public.etp_user_empresas
  for all
  to service_role
  using (true)
  with check (true);

comment on table  public.etp_user_empresas            is 'Vincula usuarios autenticados a empresas com um role especifico';
comment on column public.etp_user_empresas.user_id    is 'auth.users.id do usuario logado';
comment on column public.etp_user_empresas.empresa_id is 'Empresa a qual o usuario pertence';
comment on column public.etp_user_empresas.role       is 'Role do usuario: admin, editor ou viewer';
