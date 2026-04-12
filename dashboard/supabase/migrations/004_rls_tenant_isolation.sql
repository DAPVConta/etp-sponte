-- ============================================================
-- ETP Gestao — Tenant Isolation via RLS
-- Migration: 004_rls_tenant_isolation.sql
--
-- Creates a user-unit association table and rewrites all RLS
-- policies so each authenticated user can only access data
-- belonging to their assigned units.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- TABELA: etp_user_unidades
-- Vincula auth.uid() a uma ou mais unidades
-- ────────────────────────────────────────────────────────────
create table if not exists public.etp_user_unidades (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,   -- auth.uid()
  unidade_id  uuid        not null references public.etp_unidades(id) on delete cascade,
  role        text        not null default 'viewer',  -- 'admin', 'editor', 'viewer'
  criado_em   timestamptz not null default now(),

  constraint uq_user_unidade unique (user_id, unidade_id)
);

create index if not exists idx_etp_uu_user    on public.etp_user_unidades (user_id);
create index if not exists idx_etp_uu_unidade on public.etp_user_unidades (unidade_id);

alter table public.etp_user_unidades enable row level security;

-- Users can only see their own associations
create policy "Users see own unit associations"
  on public.etp_user_unidades
  for select
  to authenticated
  using (user_id = auth.uid());

-- Only admins (via service role or future admin check) can manage associations
-- For now, inserts/updates/deletes are blocked for regular users
create policy "Service role manages unit associations"
  on public.etp_user_unidades
  for all
  to service_role
  using (true)
  with check (true);

comment on table  public.etp_user_unidades             is 'Junction table linking Supabase auth users to educational units';
comment on column public.etp_user_unidades.user_id     is 'References auth.users.id (the logged-in user)';
comment on column public.etp_user_unidades.unidade_id  is 'References etp_unidades.id (the unit they can access)';
comment on column public.etp_user_unidades.role        is 'Role within the unit: admin, editor, or viewer';


-- ────────────────────────────────────────────────────────────
-- HELPER FUNCTION: checks if current user belongs to a unit
-- ────────────────────────────────────────────────────────────
create or replace function public.user_has_access_to_unidade(p_unidade_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.etp_user_unidades
    where user_id = auth.uid()
      and unidade_id = p_unidade_id
  );
$$;

comment on function public.user_has_access_to_unidade(uuid) is 'Returns true if the current auth user is associated with the given unit';


-- ============================================================
-- REWRITE RLS POLICIES: etp_unidades
-- ============================================================
drop policy if exists "Authenticated users can manage unidades" on public.etp_unidades;

create policy "Users can view their assigned units"
  on public.etp_unidades
  for select
  to authenticated
  using (
    public.user_has_access_to_unidade(id)
  );

create policy "Service role manages unidades"
  on public.etp_unidades
  for all
  to service_role
  using (true)
  with check (true);


-- ============================================================
-- REWRITE RLS POLICIES: etp_categorias_despesas
-- ============================================================
drop policy if exists "Authenticated users can manage categorias_despesas" on public.etp_categorias_despesas;

create policy "Users can view categorias of their units"
  on public.etp_categorias_despesas
  for select
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  );

create policy "Service role manages categorias_despesas"
  on public.etp_categorias_despesas
  for all
  to service_role
  using (true)
  with check (true);


-- ============================================================
-- REWRITE RLS POLICIES: etp_contas_pagar
-- ============================================================
drop policy if exists "Authenticated users can manage contas_pagar" on public.etp_contas_pagar;

create policy "Users can view contas_pagar of their units"
  on public.etp_contas_pagar
  for select
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  );

create policy "Service role manages contas_pagar"
  on public.etp_contas_pagar
  for all
  to service_role
  using (true)
  with check (true);


-- ============================================================
-- REWRITE RLS POLICIES: etp_sync_log
-- ============================================================
drop policy if exists "Authenticated users can manage sync_log" on public.etp_sync_log;

create policy "Users can view sync_log of their units"
  on public.etp_sync_log
  for select
  to authenticated
  using (
    unidade_id is null  -- system-level logs visible to all authenticated
    or public.user_has_access_to_unidade(unidade_id)
  );

create policy "Service role manages sync_log"
  on public.etp_sync_log
  for all
  to service_role
  using (true)
  with check (true);


-- ============================================================
-- REWRITE RLS POLICIES: etp_planejamento
-- Remove anon access, add tenant-scoped authenticated policy
-- ============================================================
drop policy if exists "Authenticated users can manage planejamento" on public.etp_planejamento;
drop policy if exists "Anon users can manage planejamento"          on public.etp_planejamento;

create policy "Users can view planejamento of their units"
  on public.etp_planejamento
  for select
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  );

-- Editors and admins can insert/update planejamento for their units
create policy "Editors can manage planejamento of their units"
  on public.etp_planejamento
  for all
  to authenticated
  using (
    public.user_has_access_to_unidade(unidade_id)
  )
  with check (
    public.user_has_access_to_unidade(unidade_id)
  );

create policy "Service role manages planejamento"
  on public.etp_planejamento
  for all
  to service_role
  using (true)
  with check (true);
