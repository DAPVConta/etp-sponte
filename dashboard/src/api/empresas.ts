import { supabase } from '../lib/supabase';
import type { Empresa, UsuarioEmpresa } from '../types';

// ── Mapeador row → Empresa ────────────────────────────────────

function mapEmpresa(row: {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  email: string | null;
  logo_url: string | null;
  ativo: boolean;
  criado_em: string;
  total_unidades?: number;
  total_usuarios?: number;
}): Empresa {
  return {
    id: row.id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    email: row.email,
    logoUrl: row.logo_url,
    ativo: row.ativo,
    criadoEm: row.criado_em,
    totalUnidades: row.total_unidades,
    totalUsuarios: row.total_usuarios,
  };
}

// ── API ───────────────────────────────────────────────────────

export const EmpresasAPI = {

  // ── Leitura ──────────────────────────────────────────────

  // Retorna a empresa do usuario logado (admin ve a propria)
  async listarMinha(): Promise<Empresa | null> {
    const { data, error } = await supabase
      .from('etp_empresas')
      .select('id, cnpj, razao_social, nome_fantasia, email, logo_url, ativo, criado_em')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapEmpresa(data);
  },

  // Lista todas as empresas — super_admin via RPC
  async listarTodas(): Promise<Empresa[]> {
    const { data, error } = await supabase.rpc('super_admin_listar_empresas');
    if (error) throw error;
    return (data || []).map(mapEmpresa);
  },

  // ── Escrita (super_admin) ────────────────────────────────

  async criar(params: {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string;
    email?: string;
    logoUrl?: string;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('super_admin_criar_empresa', {
      p_cnpj:          params.cnpj,
      p_razao_social:  params.razaoSocial,
      p_nome_fantasia: params.nomeFantasia,
      p_email:         params.email ?? null,
      p_logo_url:      params.logoUrl ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  async atualizar(id: string, campos: Partial<{
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string;
    email: string | null;
    logoUrl: string | null;
  }>): Promise<void> {
    const { error } = await supabase
      .from('etp_empresas')
      .update({
        ...(campos.cnpj          !== undefined && { cnpj: campos.cnpj }),
        ...(campos.razaoSocial   !== undefined && { razao_social: campos.razaoSocial }),
        ...(campos.nomeFantasia  !== undefined && { nome_fantasia: campos.nomeFantasia }),
        ...(campos.email         !== undefined && { email: campos.email }),
        ...(campos.logoUrl       !== undefined && { logo_url: campos.logoUrl }),
      })
      .eq('id', id);
    if (error) throw error;
  },

  async toggleAtivo(id: string, ativo: boolean): Promise<void> {
    const { error } = await supabase.rpc('super_admin_toggle_empresa', {
      p_empresa_id: id,
      p_ativo: ativo,
    });
    if (error) throw error;
  },

  // ── Gestao de usuarios ───────────────────────────────────

  async listarUsuarios(empresaId: string): Promise<UsuarioEmpresa[]> {
    const { data, error } = await supabase.rpc('listar_usuarios_empresa', {
      p_empresa_id: empresaId,
    });
    if (error) throw error;
    return (data || []).map((row: {
      user_id: string; email: string; role: string; criado_em: string;
    }) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role as UsuarioEmpresa['role'],
      criadoEm: row.criado_em,
    }));
  },

  async vincularUsuario(userId: string, empresaId: string, role: string): Promise<void> {
    const { error } = await supabase.rpc('vincular_usuario_empresa', {
      p_user_id:    userId,
      p_empresa_id: empresaId,
      p_role:       role,
    });
    if (error) throw error;
  },

  async desvincularUsuario(userId: string, empresaId: string): Promise<void> {
    const { error } = await supabase.rpc('desvincular_usuario_empresa', {
      p_user_id:    userId,
      p_empresa_id: empresaId,
    });
    if (error) throw error;
  },

  // Convida usuario via Edge Function (usa service_role no servidor)
  async convidarUsuario(email: string, empresaId: string, role: string): Promise<void> {
    const { error } = await supabase.functions.invoke('invite-user', {
      body: { email, empresaId, role },
    });
    if (error) throw error;
  },
};
