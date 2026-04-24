import { supabase } from '../lib/supabase';
import type { FluxoCaixaLancamento } from '../lib/pdf-fluxo-caixa';

export interface ImportCaixaResult {
  inseridos: number;
  removidosAntesDeInserir: number;
}

// Gera conta_pagar_id determinístico cabendo em int32.
// AAMMDD * 100 + idx  → ex 2026-01-06 idx=1 → 26010601 → negativo para marcar CAIXA
function gerarContaPagarId(dataISO: string, idx: number): number {
  const [y, m, d] = dataISO.split('-').map(Number);
  const yy = y % 100;
  return -((yy * 10000 + m * 100 + d) * 100 + idx);
}

/**
 * Importa lançamentos de caixa como linhas na etp_contas_pagar.
 * - Remove antes todas as linhas (unidade_id, forma_cobranca='CAIXA', data_pagamento no período)
 *   para garantir idempotência / evitar duplicidade.
 * - Insere as novas linhas marcadas com forma_cobranca='CAIXA'.
 */
export async function importarLancamentosCaixa(
  unidadeId: string,
  periodoInicioISO: string,
  periodoFimISO: string,
  lancamentos: FluxoCaixaLancamento[]
): Promise<ImportCaixaResult> {
  // 1) Remove existentes no período (idempotência)
  const { data: existentes, error: errExist } = await supabase
    .from('etp_contas_pagar')
    .select('conta_pagar_id, numero_parcela')
    .eq('unidade_id', unidadeId)
    .eq('forma_cobranca', 'CAIXA')
    .gte('data_pagamento', periodoInicioISO)
    .lte('data_pagamento', periodoFimISO);
  if (errExist) throw errExist;

  const removidosAntesDeInserir = existentes?.length ?? 0;

  if (removidosAntesDeInserir > 0) {
    const { error: errDel } = await supabase
      .from('etp_contas_pagar')
      .delete()
      .eq('unidade_id', unidadeId)
      .eq('forma_cobranca', 'CAIXA')
      .gte('data_pagamento', periodoInicioISO)
      .lte('data_pagamento', periodoFimISO);
    if (errDel) throw errDel;
  }

  if (lancamentos.length === 0) {
    return { inseridos: 0, removidosAntesDeInserir };
  }

  // 2) Insere novas linhas. conta_pagar_id único dentro do período (AAMMDD*100 + idx por dia)
  //    Para evitar colisão quando mesma unidade tem N lançamentos no mesmo dia, indexa por data.
  const idxPorDia = new Map<string, number>();
  const payload = lancamentos.map(l => {
    const n = (idxPorDia.get(l.data) ?? 0) + 1;
    idxPorDia.set(l.data, n);
    const contaPagarId = gerarContaPagarId(l.data, n);
    return {
      unidade_id: unidadeId,
      conta_pagar_id: contaPagarId,
      numero_parcela: '1/1',
      sacado: l.origemDestino || 'Caixa',
      categoria: l.categoria,
      forma_cobranca: 'CAIXA',
      tipo_recebimento: '',
      vencimento: l.data,
      data_pagamento: l.data,
      valor_parcela: l.valor,
      valor_pago: l.valor,
      situacao_parcela: l.tipo === 'S' ? 'Pago' : 'Recebido',
      sincronizado_em: new Date().toISOString(),
    };
  });

  // Lotes de 500
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from('etp_contas_pagar')
      .upsert(slice, { onConflict: 'unidade_id,conta_pagar_id,numero_parcela' });
    if (error) throw error;
  }

  return { inseridos: payload.length, removidosAntesDeInserir };
}
