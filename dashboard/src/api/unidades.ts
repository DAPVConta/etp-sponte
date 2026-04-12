import { supabase } from '../lib/supabase';
import type { Unidade } from '../types';

export const UnidadesAPI = {
  async listar(): Promise<Unidade[]> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .select('id, cnpj, nome, cor, codigo_sponte, token_sponte, criado_em')
      .order('criado_em', { ascending: true });

    if (error) throw error;

    // Convert from snake_case to camelCase
    return (data || []).map(row => ({
      id: row.id,
      cnpj: row.cnpj,
      nome: row.nome,
      cor: row.cor,
      codigoSponte: row.codigo_sponte,
      tokenSponte: row.token_sponte,
      criadoEm: row.criado_em,
    }));
  },

  async criar(unidade: Omit<Unidade, 'id' | 'criadoEm'>): Promise<Unidade> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .insert({
        cnpj: unidade.cnpj,
        nome: unidade.nome,
        cor: unidade.cor,
        codigo_sponte: unidade.codigoSponte,
        token_sponte: unidade.tokenSponte,
      })
      .select('id, cnpj, nome, cor, codigo_sponte, token_sponte, criado_em')
      .single();

    if (error) throw error;

    return {
      id: data.id,
      cnpj: data.cnpj,
      nome: data.nome,
      cor: data.cor,
      codigoSponte: data.codigo_sponte,
      tokenSponte: data.token_sponte,
      criadoEm: data.criado_em,
    };
  },

  async atualizar(id: string, unidade: Omit<Unidade, 'id' | 'criadoEm'>): Promise<Unidade> {
    const { data, error } = await supabase
      .from('etp_unidades')
      .update({
        cnpj: unidade.cnpj,
        nome: unidade.nome,
        cor: unidade.cor,
        codigo_sponte: unidade.codigoSponte,
        token_sponte: unidade.tokenSponte,
      })
      .eq('id', id)
      .select('id, cnpj, nome, cor, codigo_sponte, token_sponte, criado_em')
      .single();

    if (error) throw error;

    return {
      id: data.id,
      cnpj: data.cnpj,
      nome: data.nome,
      cor: data.cor,
      codigoSponte: data.codigo_sponte,
      tokenSponte: data.token_sponte,
      criadoEm: data.criado_em,
    };
  },

  async excluir(id: string): Promise<void> {
    const { error } = await supabase
      .from('etp_unidades')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
};
