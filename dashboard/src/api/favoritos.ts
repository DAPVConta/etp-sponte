import { supabase } from '../lib/supabase';

export type FavoritoNatureza = 'cp' | 'cr';

export const FavoritosAPI = {

  // Busca nomes de categorias favoritas de uma natureza (cp ou cr) da empresa
  // do usuario logado. RLS filtra por empresa_id.
  async listar(natureza: FavoritoNatureza = 'cp'): Promise<string[]> {
    const { data, error } = await supabase
      .from('etp_categorias_favoritas')
      .select('categoria')
      .eq('natureza', natureza)
      .order('categoria');
    if (error) throw error;
    return (data || []).map(r => r.categoria);
  },

  // Toggle: adiciona se nao existe, remove se ja existe.
  // (empresa_id, categoria, natureza) e unico.
  async toggle(categoria: string, empresaId: string, natureza: FavoritoNatureza = 'cp'): Promise<boolean> {
    const { data } = await supabase
      .from('etp_categorias_favoritas')
      .select('id')
      .eq('categoria', categoria)
      .eq('empresa_id', empresaId)
      .eq('natureza', natureza)
      .maybeSingle();

    if (data) {
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .delete()
        .eq('categoria', categoria)
        .eq('empresa_id', empresaId)
        .eq('natureza', natureza);
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .insert({ categoria, empresa_id: empresaId, natureza });
      if (error) throw error;
      return true;
    }
  },
};
