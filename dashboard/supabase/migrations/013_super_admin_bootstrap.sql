-- ============================================================
-- ETP Gestao — Bootstrap Super Admin
-- Migration: 013_super_admin_bootstrap.sql
--
-- Funcoes usadas pelo painel de super_admin para criar empresas,
-- convidar admins e gerenciar vinculos de usuarios.
--
-- Todas as funcoes sao SECURITY DEFINER e verificam is_super_admin()
-- antes de executar qualquer operacao privilegiada.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- Cria uma empresa (somente super_admin)
-- ────────────────────────────────────────────────────────────
create or replace function public.super_admin_criar_empresa(
  p_cnpj          text,
  p_razao_social  text,
  p_nome_fantasia text,
  p_email         text    default null,
  p_logo_url      text    default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_empresa_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin pode criar empresas';
  end if;

  insert into public.etp_empresas (cnpj, razao_social, nome_fantasia, email, logo_url)
  values (p_cnpj, p_razao_social, p_nome_fantasia, p_email, p_logo_url)
  returning id into v_empresa_id;

  return v_empresa_id;
end;
$$;

comment on function public.super_admin_criar_empresa(text, text, text, text, text)
  is 'Cria uma nova empresa com todos os campos. Requer role super_admin no JWT.';


-- ────────────────────────────────────────────────────────────
-- Vincula um usuario a uma empresa com um role
-- ────────────────────────────────────────────────────────────
create or replace function public.vincular_usuario_empresa(
  p_user_id    uuid,
  p_empresa_id uuid,
  p_role       text default 'viewer'
)
returns void
language plpgsql
security definer
as $$
begin
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.etp_user_empresas
      where user_id = auth.uid()
        and empresa_id = p_empresa_id
        and role = 'admin'
    )
  ) then
    raise exception 'Acesso negado: apenas super_admin ou admin da empresa pode vincular usuarios';
  end if;

  if p_role not in ('admin', 'editor', 'viewer') then
    raise exception 'Role invalido: use admin, editor ou viewer';
  end if;

  insert into public.etp_user_empresas (user_id, empresa_id, role)
  values (p_user_id, p_empresa_id, p_role)
  on conflict (user_id, empresa_id)
  do update set role = excluded.role, atualizado_em = now();
end;
$$;

comment on function public.vincular_usuario_empresa(uuid, uuid, text)
  is 'Vincula (ou atualiza role de) um usuario a uma empresa.';


-- ────────────────────────────────────────────────────────────
-- Remove vinculo de usuario de uma empresa
-- ────────────────────────────────────────────────────────────
create or replace function public.desvincular_usuario_empresa(
  p_user_id    uuid,
  p_empresa_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.etp_user_empresas
      where user_id = auth.uid()
        and empresa_id = p_empresa_id
        and role = 'admin'
    )
  ) then
    raise exception 'Acesso negado';
  end if;

  delete from public.etp_user_empresas
  where user_id = p_user_id and empresa_id = p_empresa_id;
end;
$$;

comment on function public.desvincular_usuario_empresa(uuid, uuid)
  is 'Remove vinculo de usuario de uma empresa.';


-- ────────────────────────────────────────────────────────────
-- Lista usuarios de uma empresa
-- ────────────────────────────────────────────────────────────
create or replace function public.listar_usuarios_empresa(p_empresa_id uuid)
returns table (
  user_id   uuid,
  email     text,
  role      text,
  criado_em timestamptz
)
language plpgsql
security definer
stable
as $$
begin
  if not (
    public.is_super_admin()
    or public.user_has_access_to_empresa(p_empresa_id)
  ) then
    raise exception 'Acesso negado';
  end if;

  return query
    select
      ue.user_id,
      u.email::text,
      ue.role,
      ue.criado_em
    from public.etp_user_empresas ue
    join auth.users u on u.id = ue.user_id
    where ue.empresa_id = p_empresa_id
    order by ue.criado_em;
end;
$$;

comment on function public.listar_usuarios_empresa(uuid)
  is 'Retorna usuarios vinculados a uma empresa com seus roles.';


-- ────────────────────────────────────────────────────────────
-- Lista todas as empresas (apenas super_admin)
-- ────────────────────────────────────────────────────────────
create or replace function public.super_admin_listar_empresas()
returns table (
  id             uuid,
  cnpj           text,
  razao_social   text,
  nome_fantasia  text,
  email          text,
  logo_url       text,
  ativo          boolean,
  total_unidades bigint,
  total_usuarios bigint,
  criado_em      timestamptz
)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin';
  end if;

  return query
    select
      e.id,
      e.cnpj,
      e.razao_social,
      e.nome_fantasia,
      e.email,
      e.logo_url,
      e.ativo,
      count(distinct u.id)       as total_unidades,
      count(distinct ue.user_id) as total_usuarios,
      e.criado_em
    from public.etp_empresas e
    left join public.etp_unidades      u  on u.empresa_id  = e.id
    left join public.etp_user_empresas ue on ue.empresa_id = e.id
    group by e.id
    order by e.criado_em;
end;
$$;

comment on function public.super_admin_listar_empresas()
  is 'Lista todas as empresas com contagem de unidades e usuarios. Requer super_admin.';


-- ────────────────────────────────────────────────────────────
-- Ativa/desativa empresa (apenas super_admin)
-- ────────────────────────────────────────────────────────────
create or replace function public.super_admin_toggle_empresa(
  p_empresa_id uuid,
  p_ativo      boolean
)
returns void
language plpgsql
security definer
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin';
  end if;

  update public.etp_empresas
  set ativo = p_ativo, atualizado_em = now()
  where id = p_empresa_id;
end;
$$;

comment on function public.super_admin_toggle_empresa(uuid, boolean)
  is 'Ativa ou desativa uma empresa. Requer super_admin.';
