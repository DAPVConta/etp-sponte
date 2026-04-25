-- ============================================================
-- ETP Gestao — Permitir tipo='caixa' em etp_sync_dias
-- Migration: 022_add_caixa_to_sync_dias.sql
--
-- A importacao de "Despesas do Caixa" (PDF Fluxo de Caixa do
-- Sponte) passa a registrar os dias do periodo importado em
-- etp_sync_dias, na mesma logica de CP/CR. Exige liberar 'caixa'
-- no CHECK existente.
-- ============================================================

alter table public.etp_sync_dias
  drop constraint if exists etp_sync_dias_tipo_check;

alter table public.etp_sync_dias
  add constraint etp_sync_dias_tipo_check
    check (tipo in ('cp', 'cr', 'caixa'));

comment on column public.etp_sync_dias.tipo is
  'Tipo de sincronizacao: cp = Contas a Pagar, cr = Contas a Receber, caixa = Despesas do Caixa (PDF mensal)';
