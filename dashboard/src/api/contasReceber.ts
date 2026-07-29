import { supabase } from '../lib/supabase';
import type { ParcelaReceber } from '../types';

export interface LancamentoCR {
  id: string;              // PK (uuid) — chave estável para React e dedupe
  contaReceberId: string;
  numeroParcela: string;
  unidadeId: string;
  sacado: string;
  alunoId: number | null;
  categoria: string;
  vencimento: string | null;
  dataPagamento: string | null;
  valorParcela: number;
  valorPago: number;
  situacaoParcela: string;
  formaCobranca: string;
  tipoRecebimento: string;
  bolsaAssociada: string;
  numeroBoleto: string | null;
  faturaId: string | null;
}

export interface LancamentoCRFiltros {
  unidadeIds?: string[];
  mes?: string | null;       // formato 'YYYY-MM' filtra por data_pagamento
  situacao?: string | null;
  categoria?: string | null;
  alunoId?: number | null;
}

// Ver nota em contasPagar.ts: .range() sem ordenação total pode repetir/pular
// linhas entre páginas. Toda query paginada abaixo desempata por id e o
// resultado passa por este dedupe.
function dedupePorId<T extends { id?: unknown }>(rows: T[]): T[] {
  const vistos = new Set<string>();
  return rows.filter(r => {
    const k = String(r.id);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export const ContasReceberAPI = {
  // Busca contas do banco (Supabase) para consumo do Dashboard.
  // Aceita um id, uma lista de ids (ex.: apenas unidades ativas) ou null (sem filtro).
  async listar(unidadeId: string | string[] | null, startDate: string, endDate: string): Promise<ParcelaReceber[]> {
    // Filtro: linhas onde vencimento OU data_pagamento caem na janela [start, end].
    // Usa OR de dois ANDs para o planner aproveitar idx_etp_cr_unid_venc e
    // idx_etp_cr_unid_pag (bitmap OR), evitando seq scan da tabela inteira.
    const windowFilter =
      `and(vencimento.gte.${startDate},vencimento.lte.${endDate}),` +
      `and(data_pagamento.gte.${startDate},data_pagamento.lte.${endDate})`;

    let allData: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('etp_contas_receber')
        .select('id, conta_receber_id, numero_parcela, sacado, aluno_id, situacao_parcela, vencimento, data_pagamento, valor_parcela, valor_pago, categoria')
        .or(windowFilter)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (Array.isArray(unidadeId)) {
        query = query.in('unidade_id', unidadeId);
      } else if (unidadeId) {
        query = query.eq('unidade_id', unidadeId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao buscar contas a receber no Supabase:', error);
        throw error;
      }

      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    // Mapear para a interface ParcelaReceber (campos em PascalCase como vem do XML).
    // Campos não usados pelos dashboards (forma_cobranca, tipo_recebimento, bolsa,
    // numero_boleto, fatura_id, conta_id, situacao_cnab) ficam como string vazia
    // para preservar o contrato do tipo sem custo de I/O.
    return dedupePorId(allData).map(row => ({
      ContaReceberID:  String(row.conta_receber_id),
      NumeroParcela:   row.numero_parcela,
      Sacado:          row.sacado || '',
      SituacaoParcela: row.situacao_parcela,
      SituacaoCNAB:    '',
      Vencimento:      row.vencimento ? `${row.vencimento}T00:00:00` : '',
      DataPagamento:   row.data_pagamento
        ? `${row.data_pagamento.split('-')[2]}/${row.data_pagamento.split('-')[1]}/${row.data_pagamento.split('-')[0]}`
        : '',
      ValorParcela:    Number(row.valor_parcela),
      ValorPago:       Number(row.valor_pago),
      Categoria:       row.categoria || '',
      FormaCobranca:   '',
      TipoRecebimento: '',
      BolsaAssociada:  '',
      NumeroBoleto:    '',
      FaturaID:        '',
      ContaID:         '',
      AlunoID:         row.aluno_id != null ? String(row.aluno_id) : '',
      RetornoOperacao: '',
    }));
  },

  // Lista de lançamentos para a tela Lançamento CR
  async listarLancamentos(filtros: LancamentoCRFiltros = {}): Promise<LancamentoCR[]> {
    const { unidadeIds, mes, situacao, categoria, alunoId } = filtros;

    let allData: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('etp_contas_receber')
        .select('id, conta_receber_id, numero_parcela, unidade_id, sacado, aluno_id, categoria, vencimento, data_pagamento, valor_parcela, valor_pago, situacao_parcela, forma_cobranca, tipo_recebimento, bolsa_associada, numero_boleto, fatura_id')
        .order('data_pagamento', { ascending: false, nullsFirst: false })
        .order('vencimento', { ascending: false })
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (unidadeIds && unidadeIds.length > 0) query = query.in('unidade_id', unidadeIds);
      if (situacao)                              query = query.eq('situacao_parcela', situacao);
      if (categoria)                             query = query.eq('categoria', categoria);
      if (alunoId)                               query = query.eq('aluno_id', alunoId);
      // Regime de COMPETENCIA: o mes filtra por VENCIMENTO (ver nota em
      // contasPagar.ts).
      if (mes) {
        const start = `${mes}-01`;
        const [ano, m] = mes.split('-').map(Number);
        const nextMonth = new Date(ano, m, 1);
        const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
        query = query.gte('vencimento', start).lt('vencimento', end);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    return dedupePorId(allData).map(row => ({
      id:              String(row.id),
      contaReceberId:  String(row.conta_receber_id),
      numeroParcela:   row.numero_parcela,
      unidadeId:       row.unidade_id,
      sacado:          row.sacado || '',
      alunoId:         row.aluno_id != null ? Number(row.aluno_id) : null,
      categoria:       row.categoria || '',
      vencimento:      row.vencimento || null,
      dataPagamento:   row.data_pagamento || null,
      valorParcela:    Number(row.valor_parcela) || 0,
      valorPago:       Number(row.valor_pago) || 0,
      situacaoParcela: row.situacao_parcela || '',
      formaCobranca:   row.forma_cobranca || '',
      tipoRecebimento: row.tipo_recebimento || '',
      bolsaAssociada:  row.bolsa_associada || '',
      numeroBoleto:    row.numero_boleto != null ? String(row.numero_boleto) : null,
      faturaId:        row.fatura_id    != null ? String(row.fatura_id)    : null,
    }));
  },

  // Totais recebidos por unidade, mês e categoria (para mapa de calor/dashboard)
  async totaisAnuaisPorUnidade(
    unidadeIds: string[],
    ano: number
  ): Promise<Record<string, Record<string, Record<string, number>>>> {
    if (!unidadeIds.length) return {};

    const startDate = `${ano}-01-01`;
    const endDate   = `${ano}-12-31`;

    let allData: { id: string; unidade_id: string; valor_pago: number; valor_parcela: number; situacao_parcela: string; vencimento: string; data_pagamento: string | null; categoria: string }[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    const windowFilter =
      `and(vencimento.gte.${startDate},vencimento.lte.${endDate}),` +
      `and(data_pagamento.gte.${startDate},data_pagamento.lte.${endDate})`;

    while (true) {
      const { data, error } = await supabase
        .from('etp_contas_receber')
        .select('id, unidade_id, valor_pago, valor_parcela, situacao_parcela, vencimento, data_pagamento, categoria')
        .in('unidade_id', unidadeIds)
        .or(windowFilter)
        .order('id', { ascending: true })
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

    for (const row of dedupePorId(allData)) {
      const uid = row.unidade_id;
      // Só considerar itens efetivamente recebidos (com data de pagamento real)
      if (!row.situacao_parcela || row.situacao_parcela === 'A Receber' || !row.data_pagamento) continue;
      // Competencia: o realizado entra no mes do VENCIMENTO (ver contasPagar.ts).
      const mes = (row.vencimento || row.data_pagamento).substring(0, 7);
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
