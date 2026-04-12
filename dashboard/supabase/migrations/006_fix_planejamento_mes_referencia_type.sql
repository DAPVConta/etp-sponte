-- ============================================================
-- ETP Gestao — Fix mes_referencia column type
-- Migration: 006_fix_planejamento_mes_referencia_type.sql
--
-- The API sends mes_referencia as 'YYYY-MM' (e.g., '2026-04')
-- but migration 003 defined it as DATE (expecting '2026-04-01').
-- This migration aligns the column type with actual usage.
-- ============================================================

-- Drop the constraint that depends on the column before altering type
alter table public.etp_planejamento
  drop constraint if exists uq_planejamento_unidade_mes_cat;

-- Change column type from date to text (CHAR(7) equivalent)
alter table public.etp_planejamento
  alter column mes_referencia type text using to_char(mes_referencia, 'YYYY-MM');

-- Re-add the unique constraint
alter table public.etp_planejamento
  add constraint uq_planejamento_unidade_mes_cat unique (unidade_id, mes_referencia, categoria);

-- Add a check constraint to ensure correct format
alter table public.etp_planejamento
  add constraint chk_mes_referencia_format check (mes_referencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

comment on column public.etp_planejamento.mes_referencia is 'Month reference in YYYY-MM format (e.g., 2026-04)';
