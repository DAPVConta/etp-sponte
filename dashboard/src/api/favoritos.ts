import { supabase } from '../lib/supabase';

export const FavoritosAPI = {

  // Busca todos os nomes de categorias favoritas
  async listar(): Promise<string[]> {
    const { data, error } = await supabase
      .from('etp_categorias_favoritas')
      .select('categoria')
      .order('categoria');
    if (error) throw error;
    return (data || []).map(r => r.categoria);
  },

  // Toggle: adiciona se não existe, remove se já existe
  async toggle(categoria: string): Promise<boolean> {
    // Verifica se já existe
    const { data } = await supabase
      .from('etp_categorias_favoritas')
      .select('id')
      .eq('categoria', categoria)
      .maybeSingle();

    if (data) {
      // Remove favorito
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .delete()
        .eq('categoria', categoria);
      if (error) throw error;
      return false; // agora NÃO é favorito
    } else {
      // Adiciona favorito
      const { error } = await supabase
        .from('etp_categorias_favoritas')
        .insert({ categoria });
      if (error) throw error;
      return true; // agora É favorito
    }
  },
};
