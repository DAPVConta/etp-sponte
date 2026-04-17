import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { EmpresaConfigAPI, type EmpresaConfig } from '../api/empresaConfig';
import { useAuth } from './AuthContext';

interface EmpresaConfigContextValue {
  config: EmpresaConfig | null;
  loading: boolean;
  update: (partial: Partial<Omit<EmpresaConfig, 'empresaId'>>) => Promise<void>;
  refresh: () => Promise<void>;
}

const EmpresaConfigContext = createContext<EmpresaConfigContextValue | null>(null);

export function EmpresaConfigProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [config, setConfig] = useState<EmpresaConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.empresaId) {
      setConfig(null);
      setLoading(false);
      return;
    }
    try {
      const data = await EmpresaConfigAPI.buscar(user.empresaId);
      setConfig(data);
    } catch (err) {
      console.error('Erro ao carregar config da empresa:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.empresaId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const update = useCallback(async (partial: Partial<Omit<EmpresaConfig, 'empresaId'>>) => {
    if (!user?.empresaId) return;
    await EmpresaConfigAPI.salvar(user.empresaId, partial);
    setConfig(prev => prev ? { ...prev, ...partial } : prev);
  }, [user?.empresaId]);

  return (
    <EmpresaConfigContext.Provider value={{ config, loading, update, refresh: load }}>
      {children}
    </EmpresaConfigContext.Provider>
  );
}

export function useEmpresaConfig(): EmpresaConfigContextValue {
  const ctx = useContext(EmpresaConfigContext);
  if (!ctx) throw new Error('useEmpresaConfig deve ser usado dentro de EmpresaConfigProvider');
  return ctx;
}
