-- ============================================================
-- ETP Gestao — Tenant Isolation em Categorias Favoritas
-- Migration: 010_add_empresa_to_categorias_favoritas.sql
--
-- Adiciona empresa_id em etp_categorias_favoritas.
-- Antes desta migration, favoritos eram globais (compartilhados
-- entre todos). Agora cada empresa tem seus proprios favoritos.
-- ============================================================

-- 1. Adiciona empresa_id
alter table public.etp_categorias_favoritas
  add column if not exists empresa_id uuid references public.etp_empresas(id) on delete cascade;

-- 2. Indice
create index if not exists idx_etp_cat_fav_empresa on public.etp_categorias_favoritas (empresa_id);

-- 3. Remove unicidade global por categoria e cria por empresa
alter table public.etp_categorias_favoritas
  drop constraint if exists etp_categorias_favoritas_categoria_key;

create unique index if not exists uq_etp_cat_fav_empresa_categoria
  on public.etp_categorias_favoritas (empresa_id, categoria);

-- NOTA: apos popular empresa_id em todos os registros existentes,
-- execute:
--   ALTER TABLE etp_categorias_favoritas ALTER COLUMN empresa_id SET NOT NULL;

comment on column public.etp_categorias_favoritas.empresa_id is 'Referencia ao tenant (etp_empresas). Favoritos sao isolados por empresa.';
