-- ============================================================
-- ETP Gestao — Unidade Matriz
-- Migration: 014_add_matriz_to_unidades.sql
--
-- Adiciona o conceito de "unidade matriz" em etp_unidades.
-- A empresa (holding/sede) pode ser cadastrada como uma das
-- unidades, marcada como matriz. Isso permite que a propria
-- empresa tenha integracao Sponte e dados financeiros proprios.
--
-- Regra de negocio:
--   - Cada empresa pode ter NO MAXIMO UMA unidade matriz
--   - A unidade matriz normalmente usa o mesmo CNPJ da empresa
--   - e opcional: a empresa pode ter apenas unidades filiais
-- ============================================================

alter table public.etp_unidades
  add column if not exists is_matriz boolean not null default false;

-- Garante unicidade: no maximo 1 unidade matriz por empresa
-- (indice parcial — so indexa linhas onde is_matriz = true)
create unique index if not exists uq_etp_unidades_matriz_por_empresa
  on public.etp_unidades (empresa_id)
  where is_matriz = true;

comment on column public.etp_unidades.is_matriz is
  'True indica que esta unidade representa a propria empresa (sede/matriz). Apenas uma unidade por empresa pode ser matriz.';
