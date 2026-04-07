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
        .select('*')
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
  }
};
