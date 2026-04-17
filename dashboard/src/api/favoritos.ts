import { supabase } from '../lib/supabase';

export const FavoritosAPI = {

  // Busca todos os nomes de categorias favoritas da empresa do usuario logado
  // RLS filtra automaticamente por empresa_id
  async listar(): Promise<string[]> {
    const { data, error } = await supabase
      .from('etp_categorias_favoritas')
      .select('categoria')
      .order('categoria');
    if (error) throw error;
    return (data || []).map(r => r.categoria);
  },

  // Toggle: adiciona se nao existe, remove se ja existe
  // empresaId obrigatorio para isolar o favorito no tenant correto
  async toggle(categoria: string, empresaId: string): Promise<boolean> {
    const { data } = await supabase
      .from('etp_categorias_favoritas')
      .select('id')
      .eq('categoria', categoria)
      .eq('empresa_id', empresaId)
      .maybeSingle();

    if (data) {
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .delete()
        .eq('categoria', categoria)
        .eq('empresa_id', empresaId);
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .insert({ categoria, empresa_id: empresaId });
      if (error) throw error;
      return true;
    }
  },
};
