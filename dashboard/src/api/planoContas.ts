import { supabase } from '../lib/supabase';

export type TipoPlano = 'grupo' | 'sub_grupo' | 'despesa' | 'receita';

export interface PlanoContasItem {
  id: string;
  nome: string;
  tipo: TipoPlano;
  grupoNome: string | null;
  subGrupoNome: string | null;
  sortOrder: number;
}

export const PlanoContasAPI = {
  /**
   * Busca todos os itens do plano de contas de uma unidade, ordenados por sort_order.
   */
  async listarPorUnidade(unidadeId: string): Promise<PlanoContasItem[]> {
    const { data, error } = await supabase
      .from('etp_plano_contas')
      .select('id, nome, tipo, grupo_nome, sub_grupo_nome, sort_order')
      .eq('unidade_id', unidadeId)
      .eq('ativo', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    return (data ?? []).map(row => ({
      id:           String(row.id),
      nome:         String(row.nome),
      tipo:         row.tipo as TipoPlano,
      grupoNome:    row.grupo_nome   ? String(row.grupo_nome)    : null,
      subGrupoNome: row.sub_grupo_nome ? String(row.sub_grupo_nome) : null,
      sortOrder:    Number(row.sort_order),
    }));
  },

  /**
   * Le a matriz global de plano de contas (etp_plano_contas_matriz) e retorna:
   *  - grupos: lista de grupos ATIVOS (tipo='grupo', ativo=true), ordenada;
   *  - categoriaToGrupo: mapa normalizado nome-da-categoria -> grupo_nome,
   *    montado de TODAS as linhas ativas (grupo/sub_grupo/despesa) para
   *    maximizar o match com a categoria que vem nos lancamentos.
   */
  async listarMatrizGrupos(): Promise<{ grupos: string[]; categoriaToGrupo: Record<string, string> }> {
    const { data, error } = await supabase
      .from('etp_plano_contas_matriz')
      .select('nome, tipo, grupo_nome, ativo')
      .eq('ativo', true);

    if (error) throw error;

    const norm = (s: string) =>
      s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

    const grupos = new Set<string>();
    const categoriaToGrupo: Record<string, string> = {};
    for (const row of data ?? []) {
      const grupoNome = row.grupo_nome ? String(row.grupo_nome) : '';
      if (row.tipo === 'grupo' && grupoNome) grupos.add(grupoNome);
      if (row.nome && grupoNome) categoriaToGrupo[norm(String(row.nome))] = grupoNome;
    }

    return {
      grupos: [...grupos].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      categoriaToGrupo,
    };
  },
};
