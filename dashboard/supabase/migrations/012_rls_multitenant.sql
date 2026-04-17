-- ============================================================
-- ETP Gestao — RLS Multi-Tenant Completo
-- Migration: 012_rls_multitenant.sql
--
-- Reescreve TODAS as policies de todas as tabelas com
-- isolamento real por empresa (tenant raiz).
--
-- Hierarquia de acesso:
--   super_admin → acesso total a todas as empresas
--   admin       → acesso total a dados da sua empresa
--   editor      → leitura + escrita de planejamento na sua empresa
--   viewer      → somente leitura na sua empresa
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FUNCOES HELPER
-- ════════════════════════════════════════════════════════════

-- Verifica se o usuario logado e super_admin
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'super_admin',
    false
  );
$$;

-- Retorna o empresa_id do usuario logado (null se super_admin ou sem vinculo)
create or replace function public.current_user_empresa_id()
returns uuid
language sql
security definer
stable
as $$
  select empresa_id
  from public.etp_user_empresas
  where user_id = auth.uid()
  limit 1;
$$;

-- Verifica se o usuario tem acesso a uma empresa especifica
create or replace function public.user_has_access_to_empresa(p_empresa_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.etp_user_empresas
      where user_id = auth.uid()
        and empresa_id = p_empresa_id
    );
$$;

-- Verifica se o usuario tem acesso a uma unidade (via empresa)
create or replace function public.user_has_access_to_unidade(p_unidade_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.etp_unidades u
      join public.etp_user_empresas ue on ue.empresa_id = u.empresa_id
      where u.id = p_unidade_id
        and ue.user_id = auth.uid()
    );
$$;

-- Verifica se o usuario tem role minimo em sua empresa
-- (ex: user_has_role_min('editor') = true para editor e admin)
create or replace function public.user_has_role_min(p_min_role text)
returns boolean
language sql
security definer
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.etp_user_empresas
      where user_id = auth.uid()
        and case p_min_role
              when 'viewer' then role in ('viewer', 'editor', 'admin')
              when 'editor' then role in ('editor', 'admin')
              when 'admin'  then role = 'admin'
              else false
            end
    );
$$;

comment on function public.is_super_admin()                          is 'True se o JWT do usuario contem user_metadata.role = super_admin';
comment on function public.current_user_empresa_id()                is 'Retorna o empresa_id vinculado ao usuario logado';
comment on function public.user_has_access_to_empresa(uuid)         is 'True se o usuario tem acesso (direto ou super_admin) a esta empresa';
comment on function public.user_has_access_to_unidade(uuid)         is 'True se o usuario tem acesso (via empresa) a esta unidade';
comment on function public.user_has_role_min(text)                  is 'True se o usuario tem role >= p_min_role na sua empresa';


-- ════════════════════════════════════════════════════════════
-- RLS: etp_empresas
-- ════════════════════════════════════════════════════════════
-- Remove policies antigas
drop policy if exists "Service role manages empresas" on public.etp_empresas;

-- super_admin ve/gerencia todas; usuario ve apenas sua empresa
create policy "Users can view their empresa"
  on public.etp_empresas
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.user_has_access_to_empresa(id)
  );

-- Apenas super_admin pode criar/editar/deletar empresas
create policy "Super admin manages empresas"
  on public.etp_empresas
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Service role manages empresas"
  on public.etp_empresas
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_unidades
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can manage unidades"   on public.etp_unidades;
drop policy if exists "Users can view their assigned units"        on public.etp_unidades;
drop policy if exists "Service role manages unidades"             on public.etp_unidades;

-- Leitura: usuario ve unidades da sua empresa
create policy "Users can view unidades of their empresa"
  on public.etp_unidades
  for select
  to authenticated
  using (
    public.user_has_access_to_empresa(empresa_id)
  );

-- Escrita: apenas admin da empresa ou super_admin
create policy "Admins can manage unidades of their empresa"
  on public.etp_unidades
  for all
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.user_has_access_to_empresa(empresa_id)
      and public.user_has_role_min('admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.user_has_access_to_empresa(empresa_id)
      and public.user_has_role_min('admin')
    )
  );

create policy "Service role manages unidades"
  on public.etp_unidades
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_categorias_despesas
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can manage categorias_despesas"   on public.etp_categorias_despesas;
drop policy if exists "Users can view categorias of their units"              on public.etp_categorias_despesas;
drop policy if exists "Service role manages categorias_despesas"             on public.etp_categorias_despesas;

create policy "Users can view categorias_despesas of their empresa"
  on public.etp_categorias_despesas
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage categorias_despesas"
  on public.etp_categorias_despesas
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  );

create policy "Service role manages categorias_despesas"
  on public.etp_categorias_despesas
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_contas_pagar
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can manage contas_pagar"   on public.etp_contas_pagar;
drop policy if exists "Users can view contas_pagar of their units"     on public.etp_contas_pagar;
drop policy if exists "Service role manages contas_pagar"             on public.etp_contas_pagar;

create policy "Users can view contas_pagar of their empresa"
  on public.etp_contas_pagar
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage contas_pagar"
  on public.etp_contas_pagar
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  );

create policy "Service role manages contas_pagar"
  on public.etp_contas_pagar
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_planejamento
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can manage planejamento"      on public.etp_planejamento;
drop policy if exists "Anon users can manage planejamento"               on public.etp_planejamento;
drop policy if exists "Users can view planejamento of their units"       on public.etp_planejamento;
drop policy if exists "Editors can manage planejamento of their units"   on public.etp_planejamento;
drop policy if exists "Service role manages planejamento"               on public.etp_planejamento;

create policy "Users can view planejamento of their empresa"
  on public.etp_planejamento
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

-- Editor e admin podem inserir/editar planejamento
create policy "Editors can manage planejamento"
  on public.etp_planejamento
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('editor')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('editor')
  );

create policy "Service role manages planejamento"
  on public.etp_planejamento
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_sync_log
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can manage sync_log"   on public.etp_sync_log;
drop policy if exists "Users can view sync_log of their units"    on public.etp_sync_log;
drop policy if exists "Service role manages sync_log"            on public.etp_sync_log;

create policy "Users can view sync_log of their empresa"
  on public.etp_sync_log
  for select
  to authenticated
  using (
    unidade_id is null
    or public.user_has_access_to_unidade(unidade_id)
  );

create policy "Admins can manage sync_log"
  on public.etp_sync_log
  for all
  to authenticated
  using (
    (unidade_id is null and public.is_super_admin())
    or (
      public.user_has_access_to_unidade(unidade_id)
      and public.user_has_role_min('admin')
    )
  )
  with check (
    (unidade_id is null and public.is_super_admin())
    or (
      public.user_has_access_to_unidade(unidade_id)
      and public.user_has_role_min('admin')
    )
  );

create policy "Service role manages sync_log"
  on public.etp_sync_log
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_sync_dias
-- ════════════════════════════════════════════════════════════
drop policy if exists "Users can view sync_dias of their units"    on public.etp_sync_dias;
drop policy if exists "Users can manage sync_dias of their units"  on public.etp_sync_dias;
drop policy if exists "Service role manages sync_dias"            on public.etp_sync_dias;

create policy "Users can view sync_dias of their empresa"
  on public.etp_sync_dias
  for select
  to authenticated
  using (public.user_has_access_to_unidade(unidade_id));

create policy "Admins can manage sync_dias"
  on public.etp_sync_dias
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
    and public.user_has_role_min('admin')
  );

create policy "Service role manages sync_dias"
  on public.etp_sync_dias
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- RLS: etp_plano_contas (se existir)
-- ════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'etp_plano_contas') then

    execute 'drop policy if exists "Authenticated users can manage plano_contas" on public.etp_plano_contas';

    execute '
      create policy "Users can view plano_contas of their empresa"
        on public.etp_plano_contas
        for select
        to authenticated
        using (public.user_has_access_to_unidade(unidade_id))
    ';

    execute '
      create policy "Admins can manage plano_contas"
        on public.etp_plano_contas
        for all
        to authenticated
        using (
          public.user_has_access_to_unidade(unidade_id)
          and public.user_has_role_min(''admin'')
        )
        with check (
          public.user_has_access_to_unidade(unidade_id)
          and public.user_has_role_min(''admin'')
        )
    ';

    execute '
      create policy "Service role manages plano_contas"
        on public.etp_plano_contas
        for all
        to service_role
        using (true)
        with check (true)
    ';

  end if;
end $$;


-- ════════════════════════════════════════════════════════════
-- RLS: etp_categorias_favoritas
-- ════════════════════════════════════════════════════════════
drop policy if exists "Authenticated users can view categorias favoritas"   on public.etp_categorias_favoritas;
drop policy if exists "Authenticated users can manage categorias favoritas" on public.etp_categorias_favoritas;
drop policy if exists "Service role manages categorias favoritas"          on public.etp_categorias_favoritas;

-- Leitura por empresa
create policy "Users can view categorias_favoritas of their empresa"
  on public.etp_categorias_favoritas
  for select
  to authenticated
  using (public.user_has_access_to_empresa(empresa_id));

-- Editor/admin podem gerenciar favoritos
create policy "Editors can manage categorias_favoritas"
  on public.etp_categorias_favoritas
  for all
  to authenticated
  using (
    public.user_has_access_to_empresa(empresa_id)
    and public.user_has_role_min('editor')
  )
  with check (
    public.user_has_access_to_empresa(empresa_id)
    and public.user_has_role_min('editor')
  );

create policy "Service role manages categorias_favoritas"
  on public.etp_categorias_favoritas
  for all
  to service_role
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════
-- Remove acesso anon de todas as tabelas (seguranca)
-- ════════════════════════════════════════════════════════════
revoke all on public.etp_empresas              from anon;
revoke all on public.etp_unidades              from anon;
revoke all on public.etp_categorias_despesas   from anon;
revoke all on public.etp_contas_pagar          from anon;
revoke all on public.etp_planejamento          from anon;
revoke all on public.etp_sync_log              from anon;
revoke all on public.etp_sync_dias             from anon;
revoke all on public.etp_categorias_favoritas  from anon;
revoke all on public.etp_user_empresas         from anon;
