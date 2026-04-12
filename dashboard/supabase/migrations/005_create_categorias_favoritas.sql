-- ============================================================
-- ETP Gestao — Categorias Favoritas
-- Migration: 005_create_categorias_favoritas.sql
-- ============================================================

create table if not exists public.etp_categorias_favoritas (
  id         uuid        primary key default gen_random_uuid(),
  categoria  text        not null unique,
  criado_em  timestamptz not null default now()
);

create index if not exists idx_etp_cat_fav_categoria on public.etp_categorias_favoritas (categoria);

alter table public.etp_categorias_favoritas enable row level security;

create policy "Authenticated users can view categorias favoritas"
  on public.etp_categorias_favoritas
  for select
  to authenticated
  using (true);

create policy "Authenticated users can manage categorias favoritas"
  on public.etp_categorias_favoritas
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Service role manages categorias favoritas"
  on public.etp_categorias_favoritas
  for all
  to service_role
  using (true)
  with check (true);

comment on table  public.etp_categorias_favoritas            is 'Categorias de despesa marcadas como favoritas para destaque no dashboard';
comment on column public.etp_categorias_favoritas.categoria  is 'Nome da categoria marcada como favorita';
