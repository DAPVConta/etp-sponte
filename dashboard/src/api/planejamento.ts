import { supabase } from '../lib/supabase';

export interface ItemPlanejamento {
  categoria: string;
  mediaSeisMeses: number;  // média dos últimos 6 meses reais
  valorPlanejado: number;  // valor digitado pelo usuário
  observacao?: string;
}

export interface PlanejamentoSalvo {
  id: string;
  unidade_id: string;
  mes_referencia: string;
  categoria: string;
  valor_planejado: number;
  observacao?: string;
}

export const PlanejamentoAPI = {

  // ── Calcula a média dos últimos 6 meses por categoria para as unidades selecionadas
  async calcularMedias(unidadeIds: string[]): Promise<ItemPlanejamento[]> {
    if (!unidadeIds.length) return [];

    const hoje = new Date();
    // Últimos 6 meses fechados (excluindo o mês corrente)
    const fimPeriodo = new Date(hoje.getFullYear(), hoje.getMonth(), 0); // último dia do mês anterior
    const inicioPeriodo = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1); // 6 meses atrás

    const inicio = inicioPeriodo.toISOString().split('T')[0];
    const fim = fimPeriodo.toISOString().split('T')[0];

    // Buscar todas as contas pagas no período para as unidades selecionadas
    let allData: any[] = [];
    let page = 0;
    const PAGE = 1000;

    while (true) {
      let q = supabase
        .from('etp_contas_pagar')
        .select('categoria, valor_pago, valor_parcela, data_pagamento, situacao_parcela')
        .in('unidade_id', unidadeIds)
        .gte('data_pagamento', inicio)
        .lte('data_pagamento', fim)
        .neq('situacao_parcela', 'Pendente')
        .range(page * PAGE, (page + 1) * PAGE - 1);

      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE) break;
      page++;
    }

    // Agregar por categoria e por mês
    // Estrutura: { categoria: { 'YYYY-MM': totalPago } }
    const aggPorMes: Record<string, Record<string, number>> = {};

    for (const row of allData) {
      const cat = row.categoria || 'Sem Categoria';
      const mes = row.data_pagamento?.substring(0, 7) || ''; // 'YYYY-MM'
      if (!mes) continue;

      const valor = Number(row.valor_pago) > 0 ? Number(row.valor_pago) : Number(row.valor_parcela);

      if (!aggPorMes[cat]) aggPorMes[cat] = {};
      aggPorMes[cat][mes] = (aggPorMes[cat][mes] || 0) + valor;
    }

    // Calcular a média dos meses em que houve lançamentos (máx 6)
    const resultado: ItemPlanejamento[] = Object.entries(aggPorMes).map(([cat, meses]) => {
      const totais = Object.values(meses);
      const media = totais.reduce((s, v) => s + v, 0) / Math.max(totais.length, 1);

      return {
        categoria: cat,
        mediaSeisMeses: Math.round(media * 100) / 100,
        valorPlanejado: Math.round(media * 100) / 100, // pré-preencher com a média
        observacao: '',
      };
    });

    // Ordenar do maior para o menor gasto médio
    return resultado.sort((a, b) => b.mediaSeisMeses - a.mediaSeisMeses);
  },

  // ── Buscar planejamento já salvo para uma/várias unidades e mês
  async buscar(unidadeIds: string[], mesReferencia: string): Promise<PlanejamentoSalvo[]> {
    if (!unidadeIds.length) return [];

    const { data, error } = await supabase
      .from('etp_planejamento')
      .select('*')
      .in('unidade_id', unidadeIds)
      .eq('mes_referencia', mesReferencia);

    if (error) throw error;
    return data || [];
  },

  // ── Salvar/atualizar planejamento (upsert) para uma unidade e mês
  async salvar(
    unidadeId: string,
    mesReferencia: string,
    itens: ItemPlanejamento[]
  ): Promise<void> {
    const payload = itens.map(item => ({
      unidade_id: unidadeId,
      mes_referencia: mesReferencia,
      categoria: item.categoria,
      valor_planejado: item.valorPlanejado,
      observacao: item.observacao || null,
    }));

    const { error } = await supabase
      .from('etp_planejamento')
      .upsert(payload, { onConflict: 'unidade_id,mes_referencia,categoria' });

    if (error) throw error;
  },

  // ── Buscar totais planejados por mês (para overlay no gráfico do dashboard)
  async totaisMensais(
    unidadeIds: string[],
    meses: string[]  // ['YYYY-MM', ...]
  ): Promise<Record<string, number>> {
    if (!unidadeIds.length || !meses.length) return {};

    let query = supabase
      .from('etp_planejamento')
      .select('mes_referencia, valor_planejado');

    if (unidadeIds.length === 1) {
      query = query.eq('unidade_id', unidadeIds[0]);
    } else {
      query = query.in('unidade_id', unidadeIds);
    }

    query = query.in('mes_referencia', meses);

    const { data, error } = await query;
    if (error) throw error;

    const totais: Record<string, number> = {};
    for (const row of data || []) {
      const mes = row.mes_referencia;
      totais[mes] = (totais[mes] || 0) + Number(row.valor_planejado);
    }
    return totais;
  },
};
