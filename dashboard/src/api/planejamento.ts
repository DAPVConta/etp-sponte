import { supabase } from '../lib/supabase';

export interface ItemPlanejamento {
  grupo: string;           // nome do grupo (ex: 'DESPESAS FIXAS')
  mediaSeisMeses: number;  // média dos últimos 6 meses reais
  valorPlanejado: number;  // valor digitado pelo usuário
  observacao?: string;
}

export interface PlanejamentoSalvo {
  id: string;
  unidade_id: string;
  mes_referencia: string;
  grupo: string;
  valor_planejado: number;
  observacao?: string;
}

export const PlanejamentoAPI = {

  // ── Calcula a média dos últimos 6 meses por GRUPO para as unidades selecionadas
  async calcularMedias(unidadeIds: string[]): Promise<ItemPlanejamento[]> {
    if (!unidadeIds.length) return [];

    const hoje = new Date();
    const fimPeriodo   = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    const inicioPeriodo = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);

    const inicio = inicioPeriodo.toISOString().split('T')[0];
    const fim    = fimPeriodo.toISOString().split('T')[0];

    // 1. Carrega mapeamento despesa → grupo_nome do plano de contas
    const { data: planoData, error: planoError } = await supabase
      .from('etp_plano_contas')
      .select('nome, grupo_nome')
      .in('unidade_id', unidadeIds)
      .eq('tipo', 'despesa');

    if (planoError) throw planoError;

    const grupoMap: Record<string, string> = {};
    for (const item of planoData || []) {
      if (item.grupo_nome) grupoMap[item.nome] = item.grupo_nome;
    }

    // 2. Busca todas as contas pagas no período
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

    // 3. Agrega por GRUPO e por mês
    const aggPorMes: Record<string, Record<string, number>> = {};

    for (const row of allData) {
      const categoria = row.categoria || 'Sem Categoria';
      const grupo = grupoMap[categoria] || categoria; // fallback ao nome da categoria
      const mes = row.data_pagamento?.substring(0, 7) || '';
      if (!mes) continue;

      const valor = Number(row.valor_pago) > 0 ? Number(row.valor_pago) : Number(row.valor_parcela);

      if (!aggPorMes[grupo]) aggPorMes[grupo] = {};
      aggPorMes[grupo][mes] = (aggPorMes[grupo][mes] || 0) + valor;
    }

    // 4. Calcula média dos meses em que houve lançamentos
    const resultado: ItemPlanejamento[] = Object.entries(aggPorMes).map(([grupo, meses]) => {
      const totais = Object.values(meses);
      const media = totais.reduce((s, v) => s + v, 0) / Math.max(totais.length, 1);

      return {
        grupo,
        mediaSeisMeses: Math.round(media * 100) / 100,
        valorPlanejado: Math.round(media * 100) / 100,
        observacao: '',
      };
    });

    return resultado.sort((a, b) => b.mediaSeisMeses - a.mediaSeisMeses);
  },

  // ── Busca planejamento já salvo para unidades e mês
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

  // ── Salvar/atualizar planejamento (upsert)
  async salvar(
    unidadeId: string,
    mesReferencia: string,
    itens: ItemPlanejamento[]
  ): Promise<void> {
    const payload = itens.map(item => ({
      unidade_id: unidadeId,
      mes_referencia: mesReferencia,
      grupo: item.grupo,
      valor_planejado: item.valorPlanejado,
      observacao: item.observacao || null,
    }));

    const { error } = await supabase
      .from('etp_planejamento')
      .upsert(payload, { onConflict: 'unidade_id,mes_referencia,grupo' });

    if (error) throw error;
  },
};
