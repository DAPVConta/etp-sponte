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

  // ── Total do último mês fechado por categoria
  async calcularUltimoMes(unidadeIds: string[]): Promise<ItemPlanejamento[]> {
    if (!unidadeIds.length) return [];

    const hoje = new Date();
    // Último mês fechado
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString().split('T')[0];
    const fim    = new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString().split('T')[0];

    let allData: any[] = [];
    let page = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('etp_contas_pagar')
        .select('categoria, valor_pago, valor_parcela, data_pagamento, situacao_parcela')
        .in('unidade_id', unidadeIds)
        .gte('data_pagamento', inicio)
        .lte('data_pagamento', fim)
        .neq('situacao_parcela', 'Pendente')
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allData = allData.concat(data);
      if (data.length < PAGE) break;
      page++;
    }

    const agg: Record<string, number> = {};
    for (const row of allData) {
      const cat   = row.categoria || 'Sem Categoria';
      const valor = Number(row.valor_pago) > 0 ? Number(row.valor_pago) : Number(row.valor_parcela);
      agg[cat] = (agg[cat] || 0) + valor;
    }

    return Object.entries(agg)
      .map(([categoria, total]) => ({
        categoria,
        mediaSeisMeses: Math.round(total * 100) / 100,
        valorPlanejado: Math.round(total * 100) / 100,
        observacao: '',
      }))
      .sort((a, b) => b.mediaSeisMeses - a.mediaSeisMeses);
  },

  // ── Buscar planejamento já salvo para uma/várias unidades e mês
  async buscar(unidadeIds: string[], mesReferencia: string): Promise<PlanejamentoSalvo[]> {
    if (!unidadeIds.length) return [];

    const mesAsText = mesReferencia.length === 10 ? mesReferencia.substring(0, 7) : mesReferencia;
    const mesAsDate = mesReferencia.length === 7  ? `${mesReferencia}-01` : mesReferencia;

    // Busca com ambos os formatos (OR)
    const { data, error } = await supabase
      .from('etp_planejamento')
      .select('*')
      .in('unidade_id', unidadeIds)
      .or(`mes_referencia.eq.${mesAsText},mes_referencia.eq.${mesAsDate}`);

    if (error) throw error;
    return data || [];
  },

  // ── Salvar/atualizar planejamento (upsert) para uma unidade e mês
  async salvar(
    unidadeId: string,
    mesReferencia: string,
    itens: ItemPlanejamento[]
  ): Promise<void> {
    // Envia como 'YYYY-MM-01' para compatibilidade com coluna DATE
    // e como 'YYYY-MM' para coluna TEXT — tenta TEXT primeiro, cai em DATE
    const mesAsDate = mesReferencia.length === 7 ? `${mesReferencia}-01` : mesReferencia;
    const mesAsText = mesReferencia.length === 10 ? mesReferencia.substring(0, 7) : mesReferencia;

    const makePayload = (mes: string) => itens.map(item => ({
      unidade_id:      unidadeId,
      mes_referencia:  mes,
      categoria:       item.categoria,
      valor_planejado: item.valorPlanejado,
      observacao:      item.observacao || null,
    }));

    // Tenta com formato TEXT (YYYY-MM) primeiro
    const payloadText = makePayload(mesAsText);
    console.log('[Planejamento] Tentativa 1 (TEXT):', { mes: mesAsText, rows: payloadText.length, sample: payloadText[0] });
    const { error: errText } = await supabase
      .from('etp_planejamento')
      .upsert(payloadText, { onConflict: 'unidade_id,mes_referencia,categoria' });

    if (!errText) { console.log('[Planejamento] Salvo com sucesso (TEXT)'); return; }
    console.warn('[Planejamento] Erro TEXT:', JSON.stringify(errText));

    // Fallback: formato DATE (YYYY-MM-01)
    const payloadDate = makePayload(mesAsDate);
    console.log('[Planejamento] Tentativa 2 (DATE):', { mes: mesAsDate, rows: payloadDate.length, sample: payloadDate[0] });
    const { error: errDate } = await supabase
      .from('etp_planejamento')
      .upsert(payloadDate, { onConflict: 'unidade_id,mes_referencia,categoria' });

    if (!errDate) { console.log('[Planejamento] Salvo com sucesso (DATE)'); return; }
    console.error('[Planejamento] Erro DATE:', JSON.stringify(errDate));
    throw new Error(`Falha ao salvar planejamento: ${errDate.message || errDate.code || JSON.stringify(errDate)}`);
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

  // ── Buscar totais planejados por mês e categoria (para filtro de categoria no gráfico)
  async totaisMensaisPorCategoria(
    unidadeIds: string[],
    meses: string[]  // ['YYYY-MM', ...]
  ): Promise<Record<string, Record<string, number>>> {
    if (!unidadeIds.length || !meses.length) return {};

    let query = supabase
      .from('etp_planejamento')
      .select('mes_referencia, categoria, valor_planejado');

    if (unidadeIds.length === 1) {
      query = query.eq('unidade_id', unidadeIds[0]);
    } else {
      query = query.in('unidade_id', unidadeIds);
    }

    query = query.in('mes_referencia', meses);

    const { data, error } = await query;
    if (error) throw error;

    // { 'YYYY-MM': { categoria: total } }
    const result: Record<string, Record<string, number>> = {};
    for (const row of data || []) {
      const mes = row.mes_referencia;
      const cat = row.categoria || '';
      if (!result[mes]) result[mes] = {};
      result[mes][cat] = (result[mes][cat] || 0) + Number(row.valor_planejado);
    }
    return result;
  },

  // ── Buscar totais planejados por unidade, mês e categoria (para tabela anual e mapa de calor)
  async totaisAnuaisPorUnidade(
    unidadeIds: string[],
    ano: number
  ): Promise<{ totais: Record<string, Record<string, number>>; porCategoria: Record<string, Record<string, Record<string, number>>> }> {
    if (!unidadeIds.length) return { totais: {}, porCategoria: {} };

    const meses = Array.from({ length: 12 }, (_, i) =>
      `${ano}-${String(i + 1).padStart(2, '0')}`
    );

    const { data, error } = await supabase
      .from('etp_planejamento')
      .select('unidade_id, mes_referencia, categoria, valor_planejado')
      .in('unidade_id', unidadeIds)
      .in('mes_referencia', meses);

    if (error) throw error;

    const totais: Record<string, Record<string, number>> = {};
    const porCategoria: Record<string, Record<string, Record<string, number>>> = {};
    for (const uid of unidadeIds) { totais[uid] = {}; porCategoria[uid] = {}; }

    for (const row of data || []) {
      const uid = row.unidade_id;
      const mes = row.mes_referencia;
      const cat = row.categoria || '';
      const val = Number(row.valor_planejado);
      if (!totais[uid]) totais[uid] = {};
      totais[uid][mes] = (totais[uid][mes] || 0) + val;
      if (!porCategoria[uid]) porCategoria[uid] = {};
      if (!porCategoria[uid][mes]) porCategoria[uid][mes] = {};
      porCategoria[uid][mes][cat] = (porCategoria[uid][mes][cat] || 0) + val;
    }
    return { totais, porCategoria };
  },
};
