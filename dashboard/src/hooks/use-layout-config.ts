import { useEmpresaConfig } from '../contexts/EmpresaConfigContext';

export interface LayoutConfig {
  corFundoMenu: string;
  corFundo: string;
  corFundoContainers: string;
  logoUrl: string;
}

const DEFAULTS: LayoutConfig = {
  corFundoMenu: '#0d1220',
  corFundo: '#f0f2f5',
  corFundoContainers: '#ffffff',
  logoUrl: '',
};

export function useLayoutConfig() {
  const { config, refresh } = useEmpresaConfig();

  return {
    corFundoMenu: config?.corFundoMenu || DEFAULTS.corFundoMenu,
    corFundo: config?.corFundo || DEFAULTS.corFundo,
    corFundoContainers: config?.corFundoContainers || DEFAULTS.corFundoContainers,
    logoUrl: config?.logoUrl || DEFAULTS.logoUrl,
    refresh,
  };
}
