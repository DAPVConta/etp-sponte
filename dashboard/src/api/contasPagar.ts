import { supabase } from '../lib/supabase';
import type { ParcelaPagar } from '../types';

export interface LancamentoCP {
  contaPagarId: string;
  numeroParcela: string;
  unidadeId: string;
  sacado: string;
  categoria: string;
  vencimento: string | null;
  dataPagamento: string | null;
  valorParcela: number;
  valorPago: number;
  situacaoParcela: string;
}

export interface LancamentoFiltros {
  unidadeIds?: string[];
  mes?: string | null;       // formato 'YYYY-MM' filtra por data_pagamento
  situacao?: string | null;
  categoria?: string | null;
}

export const ContasPagarAPI = {
  // Busca contas do banco de dados (Supabase) para o Dashboard
  async listar(unidadeId: string | null, startDate: string, endDate: string): Promise<ParcelaPagar[]> {
    // Filtro: linhas onde vencimento OU data_pagamento caem na janela [start, end].
    // Usa OR de dois ANDs para o planner aproveitar idx_etp_cp_unid_venc e
    // idx_etp_cp_unid_pag (bitmap OR), evitando seq scan da tabela inteira.
    const windowFilter =
      `and(vencimento.gte.${startDate},vencimento.lte.${endDate}),` +
      `and(data_pagamento.gte.${startDate},data_pagamento.lte.${endDate})`;

    let allData: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('etp_contas_pagar')
        .select('conta_pagar_id, numero_parcela, sacado, situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago, categoria')
        .or(windowFilter)
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
      FormaCobranca: '',
      TipoRecebimento: '',
      ContaID: '',
      RetornoOperacao: ''
    }));
  },

  // Lista de lançamentos para a tela Lançamento CP
  async listarLancamentos(filtros: LancamentoFiltros = {}): Promise<LancamentoCP[]> {
    const { unidadeIds, mes, situacao, categoria } = filtros;

    let allData: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('etp_contas_pagar')
        .select('conta_pagar_id, numero_parcela, unidade_id, sacado, categoria, vencimento, data_pagamento, valor_parcela, valor_pago, situacao_parcela')
        .order('data_pagamento', { ascending: false, nullsFirst: false })
        .order('vencimento', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (unidadeIds && unidadeIds.length > 0) query = query.in('unidade_id', unidadeIds);
      if (situacao)                              query = query.eq('situacao_parcela', situacao);
      if (categoria)                             query = query.eq('categoria', categoria);
      if (mes) {
        const start = `${mes}-01`;
        const [ano, m] = mes.split('-').map(Number);
        const nextMonth = new Date(ano, m, 1);
        const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
        query = query.gte('data_pagamento', start).lt('data_pagamento', end);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    return allData.map(row => ({
      contaPagarId:    String(row.conta_pagar_id),
      numeroParcela:   row.numero_parcela,
      unidadeId:       row.unidade_id,
      sacado:          row.sacado || '',
      categoria:       row.categoria || '',
      vencimento:      row.vencimento || null,
      dataPagamento:   row.data_pagamento || null,
      valorParcela:    Number(row.valor_parcela) || 0,
      valorPago:       Number(row.valor_pago) || 0,
      situacaoParcela: row.situacao_parcela || '',
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

    const windowFilter =
      `and(vencimento.gte.${startDate},vencimento.lte.${endDate}),` +
      `and(data_pagamento.gte.${startDate},data_pagamento.lte.${endDate})`;

    while (true) {
      const { data, error } = await supabase
        .from('etp_contas_pagar')
        .select('unidade_id, valor_pago, valor_parcela, situacao_parcela, vencimento, data_pagamento, categoria')
        .in('unidade_id', unidadeIds)
        .or(windowFilter)
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
