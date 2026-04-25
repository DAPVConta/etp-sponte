import { supabase } from '../lib/supabase';

export type SyncTipo = 'cp' | 'cr' | 'caixa';

export interface SyncDia {
  unidade_id: string;
  data: string;        // YYYY-MM-DD
  tipo: SyncTipo;
  registros: number;
  sincronizado_em: string;
}

export const SyncDiasAPI = {
  /**
   * Registra (upsert) um dia sincronizado para uma unidade e tipo.
   * Se o dia/tipo ja existir, atualiza a contagem e o timestamp.
   */
  async registrar(unidadeId: string, data: string, registros: number, tipo: SyncTipo = 'cp'): Promise<void> {
    const { error } = await supabase
      .from('etp_sync_dias')
      .upsert(
        {
          unidade_id: unidadeId,
          data,
          tipo,
          registros,
          sincronizado_em: new Date().toISOString(),
        },
        { onConflict: 'unidade_id,data,tipo' }
      );

    if (error) {
      console.error('Erro ao registrar sync dia:', error);
      throw error;
    }
  },

  /**
   * Registra varios dias de uma vez (batch upsert) para um dado tipo.
   */
  async registrarBatch(
    unidadeId: string,
    dias: { data: string; registros: number }[],
    tipo: SyncTipo = 'cp'
  ): Promise<void> {
    if (!dias.length) return;

    const payload = dias.map(d => ({
      unidade_id: unidadeId,
      data: d.data,
      tipo,
      registros: d.registros,
      sincronizado_em: new Date().toISOString(),
    }));

    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const batch = payload.slice(i, i + BATCH);
      const { error } = await supabase
        .from('etp_sync_dias')
        .upsert(batch, { onConflict: 'unidade_id,data,tipo' });

      if (error) {
        console.error('Erro ao registrar batch sync dias:', error);
        throw error;
      }
    }
  },

  /**
   * Lista dias sincronizados de uma ou mais unidades, opcionalmente
   * filtrados por periodo e tipo. Se `tipo` for omitido, retorna todos.
   */
  async listar(
    unidadeIds: string[],
    dataInicio?: string,
    dataFim?: string,
    tipo?: SyncTipo
  ): Promise<SyncDia[]> {
    if (!unidadeIds.length) return [];

    const all: SyncDia[] = [];
    const PAGE = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let q = supabase
        .from('etp_sync_dias')
        .select('unidade_id, data, tipo, registros, sincronizado_em')
        .in('unidade_id', unidadeIds)
        .order('data', { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (dataInicio) q = q.gte('data', dataInicio);
      if (dataFim)    q = q.lte('data', dataFim);
      if (tipo)       q = q.eq('tipo', tipo);

      const { data, error } = await q;

      if (error) {
        console.error('Erro ao listar sync dias:', error);
        throw error;
      }
      if (data && data.length > 0) {
        all.push(...(data as SyncDia[]));
        offset += PAGE;
        hasMore = data.length === PAGE;
      } else {
        hasMore = false;
      }
    }

    return all;
  },
};
