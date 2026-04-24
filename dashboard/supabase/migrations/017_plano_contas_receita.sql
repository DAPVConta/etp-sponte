-- ============================================================
-- ETP Gestao — Aceitar 'receita' no plano de contas
-- Migration: 017_plano_contas_receita.sql
--
-- Expande o CHECK constraint da coluna `tipo` em
-- etp_plano_contas e etp_plano_contas_matriz para aceitar
-- 'receita' alem de 'grupo', 'sub_grupo', 'despesa'.
--
-- Isto permite reutilizar a estrutura hierarquica (grupo ->
-- sub_grupo -> folha) tambem para Contas a Receber (CR),
-- habilitando agrupamento no Dashboard CR equivalente ao CP.
-- ============================================================

-- ── etp_plano_contas ────────────────────────────────────────
alter table public.etp_plano_contas
  drop constraint if exists etp_plano_contas_tipo_check;

alter table public.etp_plano_contas
  add constraint etp_plano_contas_tipo_check
    check (tipo in ('grupo', 'sub_grupo', 'despesa', 'receita'));

-- ── etp_plano_contas_matriz ─────────────────────────────────
alter table public.etp_plano_contas_matriz
  drop constraint if exists etp_plano_contas_matriz_tipo_check;

alter table public.etp_plano_contas_matriz
  add constraint etp_plano_contas_matriz_tipo_check
    check (tipo in ('grupo', 'sub_grupo', 'despesa', 'receita'));

comment on column public.etp_plano_contas.tipo is
  'Tipo do no: grupo, sub_grupo, despesa (folha de CP) ou receita (folha de CR)';
comment on column public.etp_plano_contas_matriz.tipo is
  'Tipo do no: grupo, sub_grupo, despesa (folha de CP) ou receita (folha de CR)';
