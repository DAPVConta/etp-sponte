-- ============================================================
-- ETP Gestao — Unidade Ativa/Desativada
-- Migration: 024_add_ativa_to_unidades.sql
--
-- Adiciona o flag "ativa" em etp_unidades. Uma unidade
-- desativada permanece cadastrada (com todos os seus dados
-- financeiros preservados), mas deixa de aparecer no sistema:
-- dashboards, lancamentos, planejamento e seletor de unidades
-- ignoram unidades desativadas.
--
-- Regra de negocio:
--   - Desativar NAO exclui nada: e reversivel a qualquer momento
--   - A pagina de Cadastro de Unidades continua exibindo todas,
--     permitindo reativar
-- ============================================================

alter table public.etp_unidades
  add column if not exists ativa boolean not null default true;

comment on column public.etp_unidades.ativa is
  'False oculta a unidade de todo o sistema (dashboards, lancamentos, seletor) sem excluir seus dados. Reversivel.';
