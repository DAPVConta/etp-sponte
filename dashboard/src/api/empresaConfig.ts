import { supabase } from '../lib/supabase';

export interface EmpresaConfig {
  empresaId: string;
  corFundoMenu: string;
  corFundo: string;
  corFundoContainers: string;
  logoUrl: string;
  dashboardVisibilidade: string[] | null;
  dashboardOrdem: string[] | null;
}

const DEFAULTS: Omit<EmpresaConfig, 'empresaId'> = {
  corFundoMenu: '#0d1220',
  corFundo: '#f0f2f5',
  corFundoContainers: '#ffffff',
  logoUrl: '',
  dashboardVisibilidade: null,
  dashboardOrdem: null,
};

function mapRow(row: Record<string, unknown>): EmpresaConfig {
  return {
    empresaId: row.empresa_id as string,
    corFundoMenu: (row.cor_fundo_menu as string) || DEFAULTS.corFundoMenu,
    corFundo: (row.cor_fundo as string) || DEFAULTS.corFundo,
    corFundoContainers: (row.cor_fundo_containers as string) || DEFAULTS.corFundoContainers,
    logoUrl: (row.logo_url as string) || '',
    dashboardVisibilidade: row.dashboard_visibilidade as string[] | null,
    dashboardOrdem: row.dashboard_ordem as string[] | null,
  };
}

export const EmpresaConfigAPI = {
  async buscar(empresaId: string): Promise<EmpresaConfig> {
    const { data, error } = await supabase
      .from('etp_empresa_config')
      .select('*')
      .eq('empresa_id', empresaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { empresaId, ...DEFAULTS };
    return mapRow(data);
  },

  async salvar(empresaId: string, config: Partial<Omit<EmpresaConfig, 'empresaId'>>): Promise<void> {
    const payload: Record<string, unknown> = { empresa_id: empresaId };

    if (config.corFundoMenu !== undefined) payload.cor_fundo_menu = config.corFundoMenu;
    if (config.corFundo !== undefined) payload.cor_fundo = config.corFundo;
    if (config.corFundoContainers !== undefined) payload.cor_fundo_containers = config.corFundoContainers;
    if (config.logoUrl !== undefined) payload.logo_url = config.logoUrl;
    if (config.dashboardVisibilidade !== undefined) payload.dashboard_visibilidade = config.dashboardVisibilidade;
    if (config.dashboardOrdem !== undefined) payload.dashboard_ordem = config.dashboardOrdem;

    const { error } = await supabase
      .from('etp_empresa_config')
      .upsert(payload, { onConflict: 'empresa_id' });

    if (error) throw error;
  },
};
