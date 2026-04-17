import { supabase } from '../lib/supabase';
import type { Unidade } from '../types';

// ── Mapeador row → Unidade ────────────────────────────────────

function mapUnidade(row: {
  id: string;
  empresa_id: string;
  cnpj: string;
  nome: string;
  cor: string;
  codigo_sponte: string;
  token_sponte: string;
  is_matriz: boolean;
  criado_em: string;
}): Unidade {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    cnpj: row.cnpj,
    nome: row.nome,
    cor: row.cor,
    codigoSponte: row.codigo_sponte,
    tokenSponte: row.token_sponte,
    isMatriz: row.is_matriz,
    criadoEm: row.criado_em,
  };
}

const SELECT_FIELDS =
  'id, empresa_id, cnpj, nome, cor, codigo_sponte, token_sponte, is_matriz, criado_em';

// ── API ───────────────────────────────────────────────────────

export const UnidadesAPI = {

  // Lista unidades da empresa do usuario logado
  // RLS filtra automaticamente pelo empresa_id
  async listar(): Promise<Unidade[]> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .select(SELECT_FIELDS)
      .order('is_matriz', { ascending: false })   // matriz aparece primeiro
      .order('criado_em', { ascending: true });

    if (error) throw error;
    return (data || []).map(mapUnidade);
  },

  async criar(unidade: Omit<Unidade, 'id' | 'criadoEm'>): Promise<Unidade> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .insert({
        empresa_id:    unidade.empresaId,
        cnpj:          unidade.cnpj,
        nome:          unidade.nome,
        cor:           unidade.cor,
        codigo_sponte: unidade.codigoSponte,
        token_sponte:  unidade.tokenSponte,
        is_matriz:     unidade.isMatriz,
      })
      .select(SELECT_FIELDS)
      .single();

    if (error) throw error;
    return mapUnidade(data);
  },

  async atualizar(id: string, unidade: Omit<Unidade, 'id' | 'criadoEm'>): Promise<Unidade> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .update({
        cnpj:          unidade.cnpj,
        nome:          unidade.nome,
        cor:           unidade.cor,
        codigo_sponte: unidade.codigoSponte,
        token_sponte:  unidade.tokenSponte,
        is_matriz:     unidade.isMatriz,
      })
      .eq('id', id)
      .select(SELECT_FIELDS)
      .single();

    if (error) throw error;
    return mapUnidade(data);
  },

  // Define uma unidade como matriz (desmarca a anterior automaticamente via DB)
  async definirComoMatriz(id: string, empresaId: string): Promise<void> {
    // Desmarca a atual matriz (se houver)
    await supabase
      .from('etp_unidades')
      .update({ is_matriz: false })
      .eq('empresa_id', empresaId)
      .eq('is_matriz', true)
      .neq('id', id);

    // Marca a nova
    const { error } = await supabase
      .from('etp_unidades')
      .update({ is_matriz: true })
      .eq('id', id);

    if (error) throw error;
  },

  async excluir(id: string): Promise<void> {
    const { error } = await supabase
      .from('etp_unidades')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};
