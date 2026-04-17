import { useState, useCallback, useEffect } from 'react';
import { useEmpresaConfig } from '../contexts/EmpresaConfigContext';

export const DASHBOARD_SECTIONS = [
  { id: 'planejamento', label: 'Planejamento Anual' },
  { id: 'evolucao',     label: 'Evolucao Mensal' },
  { id: 'heatmap',      label: 'Mapa de Calor' },
  { id: 'abc',          label: 'Curva ABC' },
  { id: 'ranking',           label: 'Ranking YTD' },
  { id: 'desvio_categoria',  label: 'Desvio por Categoria' },
  { id: 'plan_vs_real',      label: 'Planejado vs Realizado' },
  { id: 'categorias',        label: 'Gastos por Categoria' },
  { id: 'detalhamento', label: 'Detalhamento' },
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]['id'];

const ALL_IDS = DASHBOARD_SECTIONS.map(s => s.id) as unknown as DashboardSectionId[];

export function useDashboardVisibility() {
  const { config, update } = useEmpresaConfig();

  const [visible, setVisible] = useState<Set<DashboardSectionId>>(() => {
    if (config?.dashboardVisibilidade) {
      return new Set(
        (config.dashboardVisibilidade as string[]).filter((id): id is DashboardSectionId =>
          DASHBOARD_SECTIONS.some(s => s.id === id)
        )
      );
    }
    return new Set(ALL_IDS);
  });

  const [order, setOrder] = useState<DashboardSectionId[]>(() => {
    if (config?.dashboardOrdem) {
      const parsed = (config.dashboardOrdem as string[]).filter((id): id is DashboardSectionId =>
        ALL_IDS.includes(id as DashboardSectionId)
      );
      const missing = ALL_IDS.filter(id => !parsed.includes(id));
      return [...parsed, ...missing];
    }
    return [...ALL_IDS];
  });

  // Sync state when config loads/changes
  useEffect(() => {
    if (config?.dashboardVisibilidade) {
      setVisible(new Set(
        (config.dashboardVisibilidade as string[]).filter((id): id is DashboardSectionId =>
          DASHBOARD_SECTIONS.some(s => s.id === id)
        )
      ));
    }
    if (config?.dashboardOrdem) {
      const parsed = (config.dashboardOrdem as string[]).filter((id): id is DashboardSectionId =>
        ALL_IDS.includes(id as DashboardSectionId)
      );
      const missing = ALL_IDS.filter(id => !parsed.includes(id));
      setOrder([...parsed, ...missing]);
    }
  }, [config?.dashboardVisibilidade, config?.dashboardOrdem]);

  const toggle = useCallback((id: DashboardSectionId) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      update({ dashboardVisibilidade: [...next] });
      return next;
    });
  }, [update]);

  const isVisible = useCallback((id: DashboardSectionId) => visible.has(id), [visible]);

  const reorder = useCallback((newOrder: DashboardSectionId[]) => {
    setOrder(newOrder);
    update({ dashboardOrdem: newOrder });
  }, [update]);

  return { visible, toggle, isVisible, order, reorder };
}

/** Leitura estatica — usa defaults quando fora do contexto */
export function getDashboardVisibility(): Set<DashboardSectionId> {
  return new Set(ALL_IDS);
}

export function getDashboardOrder(): DashboardSectionId[] {
  return [...ALL_IDS];
}
