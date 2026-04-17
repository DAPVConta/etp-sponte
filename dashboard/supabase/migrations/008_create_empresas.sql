-- ============================================================
-- ETP Gestao — Tabela Raiz do Multi-Tenant
-- Migration: 008_create_empresas.sql
--
-- Cria a tabela etp_empresas, tenant raiz do sistema.
-- Cada empresa (cliente) pode ter N unidades educacionais,
-- N usuarios e todos os dados financeiros isolados.
--
-- Campos principais:
--   cnpj          — CNPJ da empresa (unico no sistema)
--   razao_social  — Razao Social oficial (registro na Receita Federal)
--   nome_fantasia — Nome comercial/marca usado na interface
--   email         — E-mail principal de contato
-- ============================================================

create table if not exists public.etp_empresas (
  id            uuid        primary key default gen_random_uuid(),

  -- Identificacao legal
  cnpj          text        not null unique,
  razao_social  text        not null,
  nome_fantasia text        not null,
  email         text,

  -- Visual
  logo_url      text,

  -- Status
  ativo         boolean     not null default true,

  -- Controle
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_etp_empresas_cnpj         on public.etp_empresas (cnpj);
create index if not exists idx_etp_empresas_razao_social on public.etp_empresas (razao_social);

create or replace trigger trg_etp_empresas_atualizado_em
  before update on public.etp_empresas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_empresas enable row level security;

-- Policies definidas em 012_rls_multitenant.sql
-- Por ora apenas service_role tem acesso
create policy "Service role manages empresas"
  on public.etp_empresas
  for all
  to service_role
  using (true)
  with check (true);

comment on table  public.etp_empresas                 is 'Tenant raiz: cada empresa e um cliente isolado do sistema ETP';
comment on column public.etp_empresas.cnpj            is 'CNPJ formatado (XX.XXX.XXX/XXXX-XX) — unico no sistema';
comment on column public.etp_empresas.razao_social    is 'Razao Social oficial conforme Receita Federal';
comment on column public.etp_empresas.nome_fantasia   is 'Nome comercial/marca exibido na interface';
comment on column public.etp_empresas.email           is 'E-mail principal de contato da empresa';
comment on column public.etp_empresas.logo_url        is 'URL do logotipo exibido no sidebar para usuarios desta empresa';
comment on column public.etp_empresas.ativo           is 'Se false, todos os usuarios desta empresa ficam sem acesso';
