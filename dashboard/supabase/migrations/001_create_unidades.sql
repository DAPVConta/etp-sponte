-- ============================================================
-- ETP Gestão — Cadastro de Unidades
-- Migration: 001_create_unidades.sql
-- ============================================================

create table if not exists public.etp_unidades (
  id            uuid        primary key default gen_random_uuid(),
  cnpj          text        not null,
  nome          text        not null,
  cor           text        not null default '#6366f1',
  codigo_sponte text        not null,
  token_sponte  text        not null,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Índice para buscas por CNPJ
create index if not exists idx_etp_unidades_cnpj on public.etp_unidades (cnpj);

-- Auto-atualiza atualizado_em em cada UPDATE
create or replace function public.set_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create or replace trigger trg_etp_unidades_atualizado_em
  before update on public.etp_unidades
  for each row execute procedure public.set_atualizado_em();

-- RLS: habilita Row Level Security
alter table public.etp_unidades enable row level security;

-- Política: qualquer usuário autenticado pode ler/escrever
-- (ajuste conforme necessário para multi-tenant)
create policy "Authenticated users can manage unidades"
  on public.etp_unidades
  for all
  to authenticated
  using (true)
  with check (true);

-- Comentários de documentação
comment on table  public.etp_unidades               is 'Unidades educacionais cadastradas no ETP';
comment on column public.etp_unidades.cnpj          is 'CNPJ formatado da unidade (ex: 00.000.000/0001-00)';
comment on column public.etp_unidades.nome          is 'Nome fantasia da unidade';
comment on column public.etp_unidades.cor           is 'Cor hex usada para identificar a unidade no sistema';
comment on column public.etp_unidades.codigo_sponte is 'Código do cliente no sistema Sponte (nCodigoCliente)';
comment on column public.etp_unidades.token_sponte  is 'Token de acesso à API Sponte (sToken)';
comment on column public.etp_unidades.ativo         is 'Se false, a unidade é ignorada nas consultas';
