import { supabase } from '../lib/supabase';
import type { RelacaoContaItem, TipoRelatorio } from '../lib/pdf-relacao-contas';
import { SyncDiasAPI } from './syncDias';

// Marcador da origem dos lancamentos importados via relatorio (distinto de
// 'CAIXA', usado pela importacao de Fluxo de Caixa, e dos valores reais que
// vem da API Sponte). Usado tambem para garantir idempotencia: ao reimportar
// um periodo, removemos antes apenas as linhas com esta origem.
export const FORMA_RELATORIO = 'RELATORIO';

export interface ImportRelatorioResult {
  inseridos: number;
  removidosAntesDeInserir: number;
}

// Mesma normalizacao aplicada em sync.ts / fluxoCaixaImport.ts.
const normalizeCategoria = (s: string | null | undefined): string => {
  if (!s) return '';
  return s.replace(/[.\s]+$/, '').trim();
};

/**
 * Importa os lancamentos de um relatorio "Relação de Contas Pagas/Recebidas"
 * para a tabela correspondente (etp_contas_pagar ou etp_contas_receber).
 *
 * Idempotente: remove antes todas as linhas (unidade, forma_cobranca=RELATORIO,
 * data_pagamento no periodo) e reinsere as selecionadas. Usa o Nº Lanç. do
 * relatorio como id estavel (conta_pagar_id / conta_receber_id), o que permite
 * o upsert reconhecer o mesmo lancamento entre reimportacoes.
 *
 * Estas unidades NAO sincronizam via API Sponte, entao nao ha deduplicacao
 * contra dados Sponte (diferente da importacao de Caixa).
 */
export async function importarRelatorioContas(
  unidadeId: string,
  tipo: TipoRelatorio,
  periodoInicioISO: string,
  periodoFimISO: string,
  itens: RelacaoContaItem[]
): Promise<ImportRelatorioResult> {
  const tabela = tipo === 'pagar' ? 'etp_contas_pagar' : 'etp_contas_receber';
  const idCol = tipo === 'pagar' ? 'conta_pagar_id' : 'conta_receber_id';
  const situacao = tipo === 'pagar' ? 'Quitada' : 'Recebida';
  const onConflict =
    tipo === 'pagar'
      ? 'unidade_id,conta_pagar_id,numero_parcela'
      : 'unidade_id,conta_receber_id,numero_parcela';

  // 1) Remove existentes no periodo (idempotencia)
  const { data: existentes, error: errExist } = await supabase
    .from(tabela)
    .select('id')
    .eq('unidade_id', unidadeId)
    .eq('forma_cobranca', FORMA_RELATORIO)
    .gte('data_pagamento', periodoInicioISO)
    .lte('data_pagamento', periodoFimISO);
  if (errExist) throw errExist;

  const removidosAntesDeInserir = existentes?.length ?? 0;
  if (removidosAntesDeInserir > 0) {
    const { error: errDel } = await supabase
      .from(tabela)
      .delete()
      .eq('unidade_id', unidadeId)
      .eq('forma_cobranca', FORMA_RELATORIO)
      .gte('data_pagamento', periodoInicioISO)
      .lte('data_pagamento', periodoFimISO);
    if (errDel) throw errDel;
  }

  if (itens.length === 0) {
    return { inseridos: 0, removidosAntesDeInserir };
  }

  // 2) Monta payload. Nº Lanç. pode (raramente) repetir no relatorio; quando
  //    isso ocorre, distingue pelo numero_parcela (1/1, 2/2, ...) para nao
  //    colidir na unique (unidade, id, numero_parcela).
  const usadoPorId = new Map<number, number>();
  const payload: Array<Record<string, unknown>> = itens.map((it) => {
    const n = (usadoPorId.get(it.numeroLanc) ?? 0) + 1;
    usadoPorId.set(it.numeroLanc, n);
    const numeroParcela = `${n}/${n}`;
    return {
      unidade_id: unidadeId,
      [idCol]: it.numeroLanc,
      numero_parcela: numeroParcela,
      sacado: it.fornecedor || '',
      categoria: normalizeCategoria(it.categoria),
      forma_cobranca: FORMA_RELATORIO,
      tipo_recebimento: '',
      vencimento: it.vencimento || it.dataPagamento,
      data_pagamento: it.dataPagamento,
      valor_parcela: it.valor,
      valor_pago: it.valor,
      situacao_parcela: situacao,
      sincronizado_em: new Date().toISOString(),
    };
  });

  // 3) Upsert em lotes de 500
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const { error } = await supabase.from(tabela).upsert(slice, { onConflict });
    if (error) throw error;
  }

  // 4) Registra cada dia do periodo em etp_sync_dias (tipo cp/cr), incluindo
  //    dias sem movimento (registros=0) — o relatorio cobre o periodo inteiro,
  //    entao o mapa de status mostra o mes como auditado.
  const tipoSync = tipo === 'pagar' ? 'cp' : 'cr';
  const contagemPorDia = new Map<string, number>();
  for (const row of payload) {
    const d = row.data_pagamento as string;
    contagemPorDia.set(d, (contagemPorDia.get(d) ?? 0) + 1);
  }
  const diasPeriodo: { data: string; registros: number }[] = [];
  for (let cur = new Date(periodoInicioISO + 'T12:00:00');
       cur <= new Date(periodoFimISO + 'T12:00:00');
       cur.setDate(cur.getDate() + 1)) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    diasPeriodo.push({ data: iso, registros: contagemPorDia.get(iso) ?? 0 });
  }
  await SyncDiasAPI.registrarBatch(unidadeId, diasPeriodo, tipoSync);

  return { inseridos: payload.length, removidosAntesDeInserir };
}
