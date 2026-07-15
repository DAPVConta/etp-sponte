-- ============================================================
-- ETP Gestao — Remove policies permissivas legadas
-- Migration: 025_drop_legacy_permissive_policies.sql
--
-- Contexto: o setup inicial (setup_completo.sql) criou policies
-- "anon ALL USING(true)" e "authenticated ALL USING(true)" em
-- varias tabelas. A migration 012 criou o RLS multi-tenant
-- correto, mas as policies legadas continuaram ativas — e como
-- policies sao combinadas com OR, qualquer pessoa com a anon key
-- (publica, embutida no bundle JS) podia ler/escrever todos os
-- dados financeiros e os tokens Sponte sem login.
--
-- Esta migration remove APENAS as policies legadas. As policies
-- multi-tenant da 012 (roles authenticated/service_role, com
-- user_has_access_to_*) permanecem intactas — o app autenticado
-- continua funcionando exatamente como antes.
--
-- Verificado antes de aplicar: a tela de login nao faz nenhuma
-- query como anon (o logo vem de URL estatica do Storage) e todas
-- as tabelas abaixo possuem policies authenticated da 012.
-- ============================================================

-- ── Acesso anonimo total (10 policies) ─────────────────────
drop policy if exists "Anon can manage etp_categorias_favoritas" on public.etp_categorias_favoritas;
drop policy if exists "Anon full access"                         on public.etp_categorias_favoritas;

drop policy if exists "Anon can manage etp_contas_pagar" on public.etp_contas_pagar;
drop policy if exists "Anon full access"                 on public.etp_contas_pagar;

drop policy if exists "Anon can manage planejamento" on public.etp_planejamento;
drop policy if exists "Anon full access"             on public.etp_planejamento;

drop policy if exists "Anon can manage etp_plano_contas"   on public.etp_plano_contas;
drop policy if exists "Anon users can manage plano_contas" on public.etp_plano_contas;

drop policy if exists "Anon users can manage sync_dias" on public.etp_sync_dias;

drop policy if exists "Anon can manage etp_sync_log" on public.etp_sync_log;
drop policy if exists "Anon full access"             on public.etp_sync_log;

drop policy if exists "Allow all for anon" on public.etp_unidades;

-- ── Authenticated sem escopo de tenant (2 policies) ────────
-- Permitiam a qualquer usuario logado de QUALQUER empresa
-- gerenciar unidades e sync_dias de todas as outras. As policies
-- da 012 ("Admins can manage ...", "Users can view ...") cobrem
-- os fluxos reais do app.
drop policy if exists "Allow all for authenticated"            on public.etp_unidades;
drop policy if exists "Authenticated users can manage sync_dias" on public.etp_sync_dias;

-- ── Grants de tabela para anon (defesa em profundidade) ────
-- Na maioria das tabelas etp_* os grants de anon ja haviam sido
-- revogados (por isso as policies anon estavam inertes), mas
-- estas ainda tinham GRANT ALL para anon. Confirmado em producao:
--   * etp_plano_contas: anon lia/escrevia 482 linhas;
--   * vw_etp_resumo_mensal: anon lia 2.986 linhas de resumo
--     financeiro de TODAS as empresas (view SECURITY DEFINER).
-- O app nunca consulta o banco como anon (login obrigatorio),
-- entao revogar nao afeta nenhum fluxo.
revoke all on table public.etp_plano_contas                from anon;
revoke all on table public.etp_plano_contas_matriz         from anon;
revoke all on table public.etp_plano_contas_pendentes      from anon;
revoke all on table public.etp_plano_contas_sponte_aliases from anon;
revoke all on table public.vw_etp_resumo_mensal            from anon;
revoke all on table public.vw_etp_resumo_mensal_receber    from anon;
