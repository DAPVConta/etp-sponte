-- ============================================================
-- ETP Gestao — Favicon por empresa
-- Migration: 021_add_favicon_to_empresa_config.sql
--
-- Adiciona coluna favicon_url em etp_empresa_config para que cada
-- empresa possa customizar o favicon exibido na aba do navegador.
-- O arquivo e armazenado no mesmo bucket da logo (Logotipo).
-- ============================================================

alter table public.etp_empresa_config
  add column if not exists favicon_url text;

comment on column public.etp_empresa_config.favicon_url is
  'URL do favicon exibido na aba do navegador; armazenado no bucket Logotipo';
