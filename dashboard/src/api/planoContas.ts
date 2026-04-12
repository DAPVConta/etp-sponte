import { supabase } from '../lib/supabase';

export type TipoPlano = 'grupo' | 'sub_grupo' | 'despesa';

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
};
