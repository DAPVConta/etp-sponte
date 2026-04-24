-- ============================================================
-- ETP Gestao — Separar favoritos CP/CR por natureza
-- Migration: 018_add_natureza_to_favoritos.sql
--
-- Adiciona coluna `natureza` em etp_categorias_favoritas para
-- distinguir favoritos de Contas a Pagar (cp) de Contas a
-- Receber (cr). Antes deste PR, so existiam favoritos de CP,
-- entao linhas existentes recebem default 'cp'.
--
-- A unicidade passa de (empresa_id, categoria) para
-- (empresa_id, categoria, natureza), permitindo que o mesmo
-- nome de categoria exista como favorito em CP e CR sem
-- colisao (ex.: "Matricula" em CP e em CR).
-- ============================================================

alter table public.etp_categorias_favoritas
  add column if not exists natureza text not null default 'cp'
    check (natureza in ('cp', 'cr'));

-- Substitui unique antigo
drop index if exists public.uq_etp_cat_fav_empresa_categoria;

create unique index if not exists uq_etp_cat_fav_empresa_categoria_natureza
  on public.etp_categorias_favoritas (empresa_id, categoria, natureza);

create index if not exists idx_etp_cat_fav_natureza
  on public.etp_categorias_favoritas (natureza);

comment on column public.etp_categorias_favoritas.natureza is
  'Natureza da categoria favorita: cp = Contas a Pagar, cr = Contas a Receber';
