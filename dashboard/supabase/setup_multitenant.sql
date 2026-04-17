-- ============================================================
-- ETP Gestao — Setup Multi-Tenant Completo
-- Execute este script no SQL Editor do Supabase:
--   Dashboard → SQL Editor → New query → Cole e clique Run
--
-- Versao: migrations 008 a 014
-- Projeto: yynlwvawjohxybsumedu
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PASSO 1 — Tabela etp_empresas (tenant raiz)
-- ════════════════════════════════════════════════════════════

create table if not exists public.etp_empresas (
  id            uuid        primary key default gen_random_uuid(),
  cnpj          text        not null unique,
  razao_social  text        not null,
  nome_fantasia text        not null,
  email         text,
  logo_url      text,
  ativo         boolean     not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_etp_empresas_cnpj         on public.etp_empresas (cnpj);
create index if not exists idx_etp_empresas_razao_social on public.etp_empresas (razao_social);

create or replace trigger trg_etp_empresas_atualizado_em
  before update on public.etp_empresas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_empresas enable row level security;

create policy "Service role manages empresas"
  on public.etp_empresas for all to service_role
  using (true) with check (true);

comment on table  public.etp_empresas               is 'Tenant raiz: cada empresa e um cliente isolado do sistema ETP';
comment on column public.etp_empresas.cnpj          is 'CNPJ formatado (XX.XXX.XXX/XXXX-XX) — unico no sistema';
comment on column public.etp_empresas.razao_social  is 'Razao Social oficial conforme Receita Federal';
comment on column public.etp_empresas.nome_fantasia is 'Nome comercial/marca exibido na interface';
comment on column public.etp_empresas.email         is 'E-mail principal de contato da empresa';
comment on column public.etp_empresas.logo_url      is 'URL do logotipo exibido no sidebar';
comment on column public.etp_empresas.ativo         is 'Se false, todos os usuarios desta empresa ficam sem acesso';


-- ════════════════════════════════════════════════════════════
-- PASSO 2 — empresa_id em etp_unidades
-- ════════════════════════════════════════════════════════════

alter table public.etp_unidades
  add column if not exists empresa_id uuid
    references public.etp_empresas(id) on delete cascade;

alter table public.etp_unidades
  add column if not exists is_matriz boolean not null default false;

create index if not exists idx_etp_unidades_empresa on public.etp_unidades (empresa_id);

drop index if exists idx_etp_unidades_cnpj;

create unique index if not exists uq_etp_unidades_cnpj_empresa
  on public.etp_unidades (empresa_id, cnpj);

-- Unicidade: no maximo 1 unidade matriz por empresa
create unique index if not exists uq_etp_unidades_matriz_por_empresa
  on public.etp_unidades (empresa_id)
  where is_matriz = true;

comment on column public.etp_unidades.empresa_id is 'Referencia ao tenant raiz (etp_empresas).';
comment on column public.etp_unidades.is_matriz  is 'True = esta unidade representa a sede/matriz da empresa. Unica por empresa.';


-- ════════════════════════════════════════════════════════════
-- PASSO 3 — empresa_id em etp_categorias_favoritas
-- ════════════════════════════════════════════════════════════

alter table public.etp_categorias_favoritas
  add column if not exists empresa_id uuid
    references public.etp_empresas(id) on delete cascade;

create index if not exists idx_etp_cat_fav_empresa on public.etp_categorias_favoritas (empresa_id);

alter table public.etp_categorias_favoritas
  drop constraint if exists etp_categorias_favoritas_categoria_key;

create unique index if not exists uq_etp_cat_fav_empresa_categoria
  on public.etp_categorias_favoritas (empresa_id, categoria);

comment on column public.etp_categorias_favoritas.empresa_id is 'Favoritos isolados por empresa.';


-- ════════════════════════════════════════════════════════════
-- PASSO 4 — Tabela etp_user_empresas
-- ════════════════════════════════════════════════════════════

drop table if exists public.etp_user_unidades cascade;

create table if not exists public.etp_user_empresas (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null,
  empresa_id    uuid        not null references public.etp_empresas(id) on delete cascade,
  role          text        not null default 'viewer'
                            check (role in ('admin', 'editor', 'viewer')),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint uq_user_empresa unique (user_id, empresa_id)
);

create index if not exists idx_etp_ue_user    on public.etp_user_empresas (user_id);
create index if not exists idx_etp_ue_empresa on public.etp_user_empresas (empresa_id);

create or replace trigger trg_etp_ue_atualizado_em
  before update on public.etp_user_empresas
  for each row execute procedure public.set_atualizado_em();

alter table public.etp_user_empresas enable row level security;

create policy "Users see own empresa associations"
  on public.etp_user_empresas for select to authenticated
  using (user_id = auth.uid());

create policy "Service role manages user_empresas"
  on public.etp_user_empresas for all to service_role
  using (true) with check (true);

comment on table  public.etp_user_empresas            is 'Vincula usuarios autenticados a empresas com role especifico';
comment on column public.etp_user_empresas.user_id    is 'auth.users.id do usuario logado';
comment on column public.etp_user_empresas.empresa_id is 'Empresa a qual o usuario pertence';
comment on column public.etp_user_empresas.role       is 'Role: admin, editor ou viewer';


-- ════════════════════════════════════════════════════════════
-- PASSO 5 — Funcoes helper de RLS
-- ════════════════════════════════════════════════════════════

create or replace function public.is_super_admin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin',
    false
  );
$$;

create or replace function public.current_user_empresa_id()
returns uuid language sql security definer stable as $$
  select empresa_id from public.etp_user_empresas
  where user_id = auth.uid() limit 1;
$$;

create or replace function public.user_has_access_to_empresa(p_empresa_id uuid)
returns boolean language sql security definer stable as $$
  select public.is_super_admin()
    or exists (
      select 1 from public.etp_user_empresas
      where user_id = auth.uid() and empresa_id = p_empresa_id
    );
$$;

create or replace function public.user_has_access_to_unidade(p_unidade_id uuid)
returns boolean language sql security definer stable as $$
  select public.is_super_admin()
    or exists (
      select 1 from public.etp_unidades u
      join public.etp_user_empresas ue on ue.empresa_id = u.empresa_id
      where u.id = p_unidade_id and ue.user_id = auth.uid()
    );
$$;

create or replace function public.user_has_role_min(p_min_role text)
returns boolean language sql security definer stable as $$
  select public.is_super_admin()
    or exists (
      select 1 from public.etp_user_empresas
      where user_id = auth.uid()
        and case p_min_role
              when 'viewer' then role in ('viewer','editor','admin')
              when 'editor' then role in ('editor','admin')
              when 'admin'  then role = 'admin'
              else false
            end
    );
$$;


-- ════════════════════════════════════════════════════════════
-- PASSO 6 — Reescrever RLS policies (todas as tabelas)
-- ════════════════════════════════════════════════════════════

-- etp_empresas
drop policy if exists "Service role manages empresas"  on public.etp_empresas;
drop policy if exists "Users can view their empresa"   on public.etp_empresas;
drop policy if exists "Super admin manages empresas"   on public.etp_empresas;

create policy "Users can view their empresa"
  on public.etp_empresas for select to authenticated
  using (public.is_super_admin() or public.user_has_access_to_empresa(id));

create policy "Super admin manages empresas"
  on public.etp_empresas for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "Service role manages empresas"
  on public.etp_empresas for all to service_role
  using (true) with check (true);

-- etp_unidades
drop policy if exists "Authenticated users can manage unidades"      on public.etp_unidades;
drop policy if exists "Users can view their assigned units"           on public.etp_unidades;
drop policy if exists "Service role manages unidades"                on public.etp_unidades;
drop policy if exists "Users can view unidades of their empresa"     on public.etp_unidades;
drop policy if exists "Admins can manage unidades of their empresa"  on public.etp_unidades;

create policy "Users can view unidades of their empresa"
  on public.etp_unidades for select to authenticated
  using (public.user_has_access_to_empresa(empresa_id));

create policy "Admins can manage unidades of their empresa"
  on public.etp_unidades for all to authenticated
  using (public.is_super_admin() or (public.user_has_access_to_empresa(empresa_id) and public.user_has_role_min('admin')))
  with check (public.is_super_admin() or (public.user_has_access_to_empresa(empresa_id) and public.user_has_role_min('admin')));

create policy "Service role manages unidades"
  on public.etp_unidades for all to service_role
  using (true) with check (true);

-- etp_categorias_despesas
drop policy if exists "Authenticated users can manage categorias_despesas"  on public.etp_categorias_despesas;
drop policy if exists "Users can view categorias of their units"             on public.etp_categorias_despesas;
drop policy if exists "Service role manages categorias_despesas"            on public.etp_categorias_despesas;
drop policy if exists "Users can view categorias_despesas of their empresa" on public.etp_categorias_despesas;
drop policy if exists "Admins can manage categorias_despesas"               on public.etp_categorias_despesas;

create policy "Users can view categorias_despesas of their empresa"
  on public.etp_categorias_despesas for select to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage categorias_despesas"
  on public.etp_categorias_despesas for all to authenticated
  using (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'))
  with check (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'));

create policy "Service role manages categorias_despesas"
  on public.etp_categorias_despesas for all to service_role
  using (true) with check (true);

-- etp_contas_pagar
drop policy if exists "Authenticated users can manage contas_pagar"  on public.etp_contas_pagar;
drop policy if exists "Users can view contas_pagar of their units"   on public.etp_contas_pagar;
drop policy if exists "Service role manages contas_pagar"            on public.etp_contas_pagar;
drop policy if exists "Users can view contas_pagar of their empresa" on public.etp_contas_pagar;
drop policy if exists "Admins can manage contas_pagar"               on public.etp_contas_pagar;

create policy "Users can view contas_pagar of their empresa"
  on public.etp_contas_pagar for select to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage contas_pagar"
  on public.etp_contas_pagar for all to authenticated
  using (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'))
  with check (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'));

create policy "Service role manages contas_pagar"
  on public.etp_contas_pagar for all to service_role
  using (true) with check (true);

-- etp_planejamento
drop policy if exists "Authenticated users can manage planejamento"    on public.etp_planejamento;
drop policy if exists "Anon users can manage planejamento"             on public.etp_planejamento;
drop policy if exists "Users can view planejamento of their units"     on public.etp_planejamento;
drop policy if exists "Editors can manage planejamento of their units" on public.etp_planejamento;
drop policy if exists "Service role manages planejamento"              on public.etp_planejamento;
drop policy if exists "Users can view planejamento of their empresa"   on public.etp_planejamento;
drop policy if exists "Editors can manage planejamento"                on public.etp_planejamento;

create policy "Users can view planejamento of their empresa"
  on public.etp_planejamento for select to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Editors can manage planejamento"
  on public.etp_planejamento for all to authenticated
  using (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('editor'))
  with check (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('editor'));

create policy "Service role manages planejamento"
  on public.etp_planejamento for all to service_role
  using (true) with check (true);

-- etp_sync_log
drop policy if exists "Authenticated users can manage sync_log"  on public.etp_sync_log;
drop policy if exists "Users can view sync_log of their units"   on public.etp_sync_log;
drop policy if exists "Service role manages sync_log"            on public.etp_sync_log;
drop policy if exists "Users can view sync_log of their empresa" on public.etp_sync_log;
drop policy if exists "Admins can manage sync_log"               on public.etp_sync_log;

create policy "Users can view sync_log of their empresa"
  on public.etp_sync_log for select to authenticated
  using (unidade_id is null or public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage sync_log"
  on public.etp_sync_log for all to authenticated
  using (
    (unidade_id is null and public.is_super_admin())
    or (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'))
  )
  with check (
    (unidade_id is null and public.is_super_admin())
    or (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'))
  );

create policy "Service role manages sync_log"
  on public.etp_sync_log for all to service_role
  using (true) with check (true);

-- etp_sync_dias
drop policy if exists "Users can view sync_dias of their units"   on public.etp_sync_dias;
drop policy if exists "Users can manage sync_dias of their units" on public.etp_sync_dias;
drop policy if exists "Service role manages sync_dias"            on public.etp_sync_dias;
drop policy if exists "Users can view sync_dias of their empresa" on public.etp_sync_dias;
drop policy if exists "Admins can manage sync_dias"               on public.etp_sync_dias;

create policy "Users can view sync_dias of their empresa"
  on public.etp_sync_dias for select to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage sync_dias"
  on public.etp_sync_dias for all to authenticated
  using (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'))
  with check (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min('admin'));

create policy "Service role manages sync_dias"
  on public.etp_sync_dias for all to service_role
  using (true) with check (true);

-- etp_plano_contas (se existir)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='etp_plano_contas') then
    execute 'drop policy if exists "Authenticated users can manage plano_contas" on public.etp_plano_contas';
    execute 'drop policy if exists "Users can view plano_contas of their empresa" on public.etp_plano_contas';
    execute 'drop policy if exists "Admins can manage plano_contas" on public.etp_plano_contas';
    execute 'drop policy if exists "Service role manages plano_contas" on public.etp_plano_contas';
    execute '
      create policy "Users can view plano_contas of their empresa"
        on public.etp_plano_contas for select to authenticated
        using (public.user_has_access_to_unidade(unidade_id))';
    execute '
      create policy "Admins can manage plano_contas"
        on public.etp_plano_contas for all to authenticated
        using (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min(''admin''))
        with check (public.user_has_access_to_unidade(unidade_id) and public.user_has_role_min(''admin''))';
    execute '
      create policy "Service role manages plano_contas"
        on public.etp_plano_contas for all to service_role
        using (true) with check (true)';
  end if;
end $$;

-- etp_categorias_favoritas
drop policy if exists "Authenticated users can view categorias favoritas"             on public.etp_categorias_favoritas;
drop policy if exists "Authenticated users can manage categorias favoritas"           on public.etp_categorias_favoritas;
drop policy if exists "Service role manages categorias favoritas"                     on public.etp_categorias_favoritas;
drop policy if exists "Users can view categorias_favoritas of their empresa"          on public.etp_categorias_favoritas;
drop policy if exists "Editors can manage categorias_favoritas"                       on public.etp_categorias_favoritas;

create policy "Users can view categorias_favoritas of their empresa"
  on public.etp_categorias_favoritas for select to authenticated
  using (public.user_has_access_to_empresa(empresa_id));

create policy "Editors can manage categorias_favoritas"
  on public.etp_categorias_favoritas for all to authenticated
  using (public.user_has_access_to_empresa(empresa_id) and public.user_has_role_min('editor'))
  with check (public.user_has_access_to_empresa(empresa_id) and public.user_has_role_min('editor'));

create policy "Service role manages categorias_favoritas"
  on public.etp_categorias_favoritas for all to service_role
  using (true) with check (true);

-- Remove acesso anon
revoke all on public.etp_empresas             from anon;
revoke all on public.etp_unidades             from anon;
revoke all on public.etp_categorias_despesas  from anon;
revoke all on public.etp_contas_pagar         from anon;
revoke all on public.etp_planejamento         from anon;
revoke all on public.etp_sync_log             from anon;
revoke all on public.etp_sync_dias            from anon;
revoke all on public.etp_categorias_favoritas from anon;
revoke all on public.etp_user_empresas        from anon;


-- ════════════════════════════════════════════════════════════
-- PASSO 7 — Funcoes super_admin
-- ════════════════════════════════════════════════════════════

create or replace function public.super_admin_criar_empresa(
  p_cnpj          text,
  p_razao_social  text,
  p_nome_fantasia text,
  p_email         text default null,
  p_logo_url      text default null
)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin pode criar empresas';
  end if;
  insert into public.etp_empresas (cnpj, razao_social, nome_fantasia, email, logo_url)
  values (p_cnpj, p_razao_social, p_nome_fantasia, p_email, p_logo_url)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vincular_usuario_empresa(
  p_user_id uuid, p_empresa_id uuid, p_role text default 'viewer'
)
returns void language plpgsql security definer as $$
begin
  if not (public.is_super_admin() or exists (
    select 1 from public.etp_user_empresas
    where user_id = auth.uid() and empresa_id = p_empresa_id and role = 'admin'
  )) then raise exception 'Acesso negado'; end if;
  if p_role not in ('admin','editor','viewer') then
    raise exception 'Role invalido'; end if;
  insert into public.etp_user_empresas (user_id, empresa_id, role)
  values (p_user_id, p_empresa_id, p_role)
  on conflict (user_id, empresa_id)
  do update set role = excluded.role, atualizado_em = now();
end;
$$;

create or replace function public.desvincular_usuario_empresa(
  p_user_id uuid, p_empresa_id uuid
)
returns void language plpgsql security definer as $$
begin
  if not (public.is_super_admin() or exists (
    select 1 from public.etp_user_empresas
    where user_id = auth.uid() and empresa_id = p_empresa_id and role = 'admin'
  )) then raise exception 'Acesso negado'; end if;
  delete from public.etp_user_empresas
  where user_id = p_user_id and empresa_id = p_empresa_id;
end;
$$;

create or replace function public.listar_usuarios_empresa(p_empresa_id uuid)
returns table (user_id uuid, email text, role text, criado_em timestamptz)
language plpgsql security definer stable as $$
begin
  if not (public.is_super_admin() or public.user_has_access_to_empresa(p_empresa_id)) then
    raise exception 'Acesso negado'; end if;
  return query
    select ue.user_id, u.email::text, ue.role, ue.criado_em
    from public.etp_user_empresas ue
    join auth.users u on u.id = ue.user_id
    where ue.empresa_id = p_empresa_id
    order by ue.criado_em;
end;
$$;

create or replace function public.super_admin_listar_empresas()
returns table (
  id uuid, cnpj text, razao_social text, nome_fantasia text,
  email text, logo_url text, ativo boolean,
  total_unidades bigint, total_usuarios bigint, criado_em timestamptz
)
language plpgsql security definer stable as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin'; end if;
  return query
    select e.id, e.cnpj, e.razao_social, e.nome_fantasia,
           e.email, e.logo_url, e.ativo,
           count(distinct u.id)       as total_unidades,
           count(distinct ue.user_id) as total_usuarios,
           e.criado_em
    from public.etp_empresas e
    left join public.etp_unidades      u  on u.empresa_id  = e.id
    left join public.etp_user_empresas ue on ue.empresa_id = e.id
    group by e.id order by e.criado_em;
end;
$$;

create or replace function public.super_admin_toggle_empresa(p_empresa_id uuid, p_ativo boolean)
returns void language plpgsql security definer as $$
begin
  if not public.is_super_admin() then
    raise exception 'Acesso negado: apenas super_admin'; end if;
  update public.etp_empresas
  set ativo = p_ativo, atualizado_em = now()
  where id = p_empresa_id;
end;
$$;


-- ════════════════════════════════════════════════════════════
-- PASSO 8 — NOT NULL em empresa_id (executar APOS migrar dados)
-- ════════════════════════════════════════════════════════════
-- Se voce ja tem unidades existentes, execute ANTES deste bloco:
--
--   -- 1. Criar a empresa
--   INSERT INTO etp_empresas (cnpj, razao_social, nome_fantasia)
--   VALUES ('00.000.000/0000-00', 'Razao Social Ltda', 'Nome Fantasia')
--   RETURNING id;
--
--   -- 2. Vincular unidades existentes (substitua o UUID abaixo)
--   UPDATE etp_unidades SET empresa_id = 'UUID_DA_EMPRESA_AQUI' WHERE empresa_id IS NULL;
--   UPDATE etp_categorias_favoritas SET empresa_id = 'UUID_DA_EMPRESA_AQUI' WHERE empresa_id IS NULL;
--
--   -- 3. Aplicar NOT NULL
--   ALTER TABLE etp_unidades ALTER COLUMN empresa_id SET NOT NULL;
--   ALTER TABLE etp_categorias_favoritas ALTER COLUMN empresa_id SET NOT NULL;

-- Se o banco estiver vazio (sem dados), execute direto:
-- ALTER TABLE etp_unidades ALTER COLUMN empresa_id SET NOT NULL;
-- ALTER TABLE etp_categorias_favoritas ALTER COLUMN empresa_id SET NOT NULL;


-- ════════════════════════════════════════════════════════════
-- PASSO 9 — Criar o primeiro super_admin
-- ════════════════════════════════════════════════════════════
-- No painel Supabase → Authentication → Users:
--   1. Crie o usuario (ou use um existente)
--   2. Clique em "..." → "Edit user"
--   3. Em "User Metadata" coloque: { "role": "super_admin" }
--   4. Salve
--
-- Ou via SQL (substitua o email):
--
--   UPDATE auth.users
--   SET raw_user_meta_data = raw_user_meta_data || '{"role":"super_admin"}'::jsonb
--   WHERE email = 'seu@email.com';

-- ════════════════════════════════════════════════════════════
-- FIM
-- ════════════════════════════════════════════════════════════
select 'Setup multi-tenant concluido com sucesso!' as resultado;
