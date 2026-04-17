import { supabase } from '../lib/supabase';
import type { ParcelaPagar } from '../types';

export const ContasPagarAPI = {
  // Busca contas do banco de dados (Supabase) para o Dashboard
  async listar(unidadeId: string | null, startDate: string, endDate: string): Promise<ParcelaPagar[]> {
    // Convertendo para YYYY-MM-DD para o Postgres
    const endStr = endDate;

    let allData: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('etp_contas_pagar')
        .select('conta_pagar_id, numero_parcela, sacado, situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago, categoria, forma_cobranca, tipo_recebimento')
        .or(`vencimento.lte.${endStr},data_pagamento.lte.${endStr}`)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (unidadeId) {
        query = query.eq('unidade_id', unidadeId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao buscar dados do Supabase:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      allData = allData.concat(data);

      if (data.length < PAGE_SIZE) {
        break;
      }

      page++;
    }

    // Mapear de volta para a interface ParcelaPagar que o frontend usa
    return allData.map(row => ({
      ContaPagarID: String(row.conta_pagar_id),
      NumeroParcela: row.numero_parcela,
      Sacado: row.sacado || '',
      SituacaoParcela: row.situacao_parcela,
      Vencimento: row.vencimento ? `${row.vencimento}T00:00:00` : '',
      DataPagamento: row.data_pagamento ? `${row.data_pagamento.split('-')[2]}/${row.data_pagamento.split('-')[1]}/${row.data_pagamento.split('-')[0]}` : '',
      ValorParcela: Number(row.valor_parcela),
      ValorPago: Number(row.valor_pago),
      Categoria: row.categoria || '',
      FormaCobranca: row.forma_cobranca || '',
      TipoRecebimento: row.tipo_recebimento || '',
      ContaID: '',
      RetornoOperacao: ''
    }));
  },

  // Totais realizados por unidade, mês e categoria (para o mapa de calor com filtro)
  async totaisAnuaisPorUnidade(
    unidadeIds: string[],
    ano: number
  ): Promise<Record<string, Record<string, Record<string, number>>>> {
    if (!unidadeIds.length) return {};

    const startDate = `${ano}-01-01`;
    const endDate   = `${ano}-12-31`;

    let allData: { unidade_id: string; valor_pago: number; valor_parcela: number; situacao_parcela: string; vencimento: string; data_pagamento: string | null; categoria: string }[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('etp_contas_pagar')
        .select('unidade_id, valor_pago, valor_parcela, situacao_parcela, vencimento, data_pagamento, categoria')
        .in('unidade_id', unidadeIds)
        .or(`vencimento.gte.${startDate},data_pagamento.gte.${startDate}`)
        .or(`vencimento.lte.${endDate},data_pagamento.lte.${endDate}`)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    // { uid: { mes: { categoria: total } } }
    const result: Record<string, Record<string, Record<string, number>>> = {};
    for (const uid of unidadeIds) result[uid] = {};

    for (const row of allData) {
      const uid = row.unidade_id;
      // Só considerar itens pagos (com data de pagamento real)
      if (!row.situacao_parcela || row.situacao_parcela === 'Pendente' || !row.data_pagamento) continue;
      const mes = row.data_pagamento.substring(0, 7);
      if (!mes.startsWith(String(ano))) continue;
      const valor = Number(row.valor_pago) > 0 ? Number(row.valor_pago) : Number(row.valor_parcela);
      const cat = row.categoria || '';
      if (!result[uid]) result[uid] = {};
      if (!result[uid][mes]) result[uid][mes] = {};
      result[uid][mes][cat] = (result[uid][mes][cat] || 0) + valor;
    }

    return result;
  }
};
