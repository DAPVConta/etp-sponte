-- ============================================================
-- ETP Gestao — Separar tipo CP/CR em etp_sync_dias
-- Migration: 016_add_tipo_to_sync_dias.sql
--
-- Adiciona coluna `tipo` para diferenciar sincronizações de
-- Contas a Pagar (cp) e Contas a Receber (cr). Antes deste
-- PR, apenas CP era sincronizado, entao linhas existentes
-- recebem o default 'cp'.
-- ============================================================

-- Adiciona coluna tipo com CHECK. Default 'cp' para preservar
-- o significado das linhas existentes (historico era so CP).
alter table public.etp_sync_dias
  add column if not exists tipo text not null default 'cp'
    check (tipo in ('cp', 'cr'));

-- Substitui unique (unidade_id, data) por (unidade_id, data, tipo)
-- de modo que CP e CR coexistam para o mesmo dia/unidade.
alter table public.etp_sync_dias
  drop constraint if exists uq_sync_dia_unidade;

alter table public.etp_sync_dias
  add constraint uq_sync_dia_unidade_tipo unique (unidade_id, data, tipo);

-- Indice auxiliar para filtros por tipo (ranking por tipo em dashboards futuros)
create index if not exists idx_etp_sync_dias_tipo on public.etp_sync_dias (tipo);

comment on column public.etp_sync_dias.tipo is 'Tipo de sincronizacao: cp = Contas a Pagar, cr = Contas a Receber';
