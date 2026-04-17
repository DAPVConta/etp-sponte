-- ============================================================
-- ETP Gestao — Vincula Unidades a Empresas
-- Migration: 009_add_empresa_to_unidades.sql
--
-- Adiciona empresa_id em etp_unidades, tornando cada unidade
-- pertencente a exatamente uma empresa (tenant raiz).
-- CNPJ passa a ser unico dentro de cada empresa.
-- ============================================================

-- 1. Adiciona coluna empresa_id (nullable inicialmente para migracao de dados)
alter table public.etp_unidades
  add column if not exists empresa_id uuid references public.etp_empresas(id) on delete cascade;

-- 2. Indice de performance
create index if not exists idx_etp_unidades_empresa on public.etp_unidades (empresa_id);

-- 3. Remove unicidade global do CNPJ e cria unicidade por empresa
--    (CNPJs diferentes de empresas diferentes nao colidem)
drop index if exists idx_etp_unidades_cnpj;

create unique index if not exists uq_etp_unidades_cnpj_empresa
  on public.etp_unidades (empresa_id, cnpj);

-- NOTA: a restricao NOT NULL em empresa_id deve ser aplicada
-- APOS popular empresa_id para todas as linhas existentes.
-- Execute o seguinte no SQL Editor do Supabase:
--
--   UPDATE etp_unidades SET empresa_id = '<sua_empresa_id>'
--   WHERE empresa_id IS NULL;
--
--   ALTER TABLE etp_unidades ALTER COLUMN empresa_id SET NOT NULL;

comment on column public.etp_unidades.empresa_id is 'Referencia ao tenant raiz (etp_empresas). Cada unidade pertence a uma empresa.';
