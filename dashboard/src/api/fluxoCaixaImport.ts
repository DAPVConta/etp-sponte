import { supabase } from '../lib/supabase';
import type { FluxoCaixaLancamento } from '../lib/pdf-fluxo-caixa';
import { SyncDiasAPI } from './syncDias';

export interface ImportCaixaResult {
  inseridos: number;
  inseridosOutrasEntradas: number;
  entradasComAlunoIgnoradas: number;
  removidosAntesDeInserir: number;
  ignoradosPorDuplicidade: number;
}

// Categoria atribuida a entradas do caixa SEM aluno (ex.: Pix avulso da
// Clinica Escola). Entradas COM aluno ja chegam pela API Sponte (GetParcelas)
// e por isso sao ignoradas aqui.
export const CATEGORIA_OUTRAS_ENTRADAS = 'Outras Entradas';

// Gera id determinístico cabendo em int32 (usado em conta_pagar_id e
// conta_receber_id). AAMMDD * 100 + idx → ex 2026-01-06 idx=1 → 26010601 →
// negativo para marcar CAIXA.
function gerarIdCaixa(dataISO: string, idx: number): number {
  const [y, m, d] = dataISO.split('-').map(Number);
  const yy = y % 100;
  return -((yy * 10000 + m * 100 + d) * 100 + idx);
}

// Mesma normalizacao aplicada em sync.ts: remove pontos finais redundantes
// que vem do cadastro do Sponte (ex.: "Rescisao Contratual..").
const normalizeCategoria = (s: string | null | undefined): string => {
  if (!s) return '';
  return s.replace(/[.\s]+$/, '').trim();
};

// Chave canonica usada para detectar duplicidade entre PDF Caixa e API Sponte:
// (data, valor, categoria-normalizada). Valor arredondado a 2 casas.
function dedupKey(dataISO: string, valor: number, categoria: string): string {
  return `${dataISO}|${valor.toFixed(2)}|${normalizeCategoria(categoria).toLowerCase()}`;
}

/**
 * Importa lançamentos de caixa:
 * - SAÍDAS (tipo S) → etp_contas_pagar (despesas pagas pelo caixa).
 * - ENTRADAS (tipo E) SEM aluno atribuído (origem/destino vazio) →
 *   etp_contas_receber com categoria "Outras Entradas". Ex.: Pix avulso
 *   "Clínica Escola" que a API Sponte (GetParcelas, por aluno) nunca retorna.
 * - ENTRADAS COM aluno são IGNORADAS: já chegam pela sincronização da API
 *   Sponte; importá-las duplicaria as receitas.
 *
 * Idempotência: remove antes todas as linhas (unidade_id,
 * forma_cobranca='CAIXA', data_pagamento no período) das DUAS tabelas e
 * insere as novas marcadas com forma_cobranca='CAIXA'.
 */
export async function importarLancamentosCaixa(
  unidadeId: string,
  periodoInicioISO: string,
  periodoFimISO: string,
  lancamentos: FluxoCaixaLancamento[]
): Promise<ImportCaixaResult> {
  const saidas = lancamentos.filter(l => l.tipo === 'S');
  const entradasSemAluno = lancamentos.filter(l => l.tipo === 'E' && !l.origemDestino.trim());
  const entradasComAlunoIgnoradas = lancamentos.length - saidas.length - entradasSemAluno.length;

  // 1) Remove existentes no período (idempotência) — nas duas tabelas
  let removidosAntesDeInserir = 0;
  for (const tabela of ['etp_contas_pagar', 'etp_contas_receber'] as const) {
    const { data: existentes, error: errExist } = await supabase
      .from(tabela)
      .select('id')
      .eq('unidade_id', unidadeId)
      .eq('forma_cobranca', 'CAIXA')
      .gte('data_pagamento', periodoInicioISO)
      .lte('data_pagamento', periodoFimISO);
    if (errExist) throw errExist;

    const n = existentes?.length ?? 0;
    removidosAntesDeInserir += n;
    if (n > 0) {
      const { error: errDel } = await supabase
        .from(tabela)
        .delete()
        .eq('unidade_id', unidadeId)
        .eq('forma_cobranca', 'CAIXA')
        .gte('data_pagamento', periodoInicioISO)
        .lte('data_pagamento', periodoFimISO);
      if (errDel) throw errDel;
    }
  }

  if (saidas.length === 0 && entradasSemAluno.length === 0) {
    return {
      inseridos: 0, inseridosOutrasEntradas: 0, entradasComAlunoIgnoradas,
      removidosAntesDeInserir, ignoradosPorDuplicidade: 0,
    };
  }

  // 2) Carrega lancamentos NAO-CAIXA do periodo (vindos da API Sponte) para
  //    deduplicar contra eles. Quando o mesmo pagamento aparece tanto no
  //    relatorio Sponte quanto no PDF Caixa (ex.: Agua Mineral pago em caixa
  //    fisico mas tambem registrado no Sponte), gravar os dois inflaria o total.
  //    Regra: ignora lancamento do PDF Caixa se ja existe linha (Sponte) com
  //    mesma (data_pagamento, valor_pago, categoria-normalizada).
  const { data: existentesSponte, error: errSp } = await supabase
    .from('etp_contas_pagar')
    .select('data_pagamento, valor_pago, categoria')
    .eq('unidade_id', unidadeId)
    .neq('forma_cobranca', 'CAIXA')
    .gte('data_pagamento', periodoInicioISO)
    .lte('data_pagamento', periodoFimISO);
  if (errSp) throw errSp;

  const dedupSet = new Set<string>();
  for (const r of existentesSponte ?? []) {
    if (!r.data_pagamento) continue;
    dedupSet.add(dedupKey(r.data_pagamento, Number(r.valor_pago) || 0, r.categoria || ''));
  }

  // 3) Insere as SAÍDAS em etp_contas_pagar. conta_pagar_id único dentro do
  //    período (AAMMDD*100 + idx por dia). Para evitar colisão quando mesma
  //    unidade tem N lançamentos no mesmo dia, indexa por data.
  let ignoradosPorDuplicidade = 0;
  const idxPorDiaCP = new Map<string, number>();
  const payload: Array<Record<string, unknown>> = [];
  for (const l of saidas) {
    if (dedupSet.has(dedupKey(l.data, l.valor, l.categoria))) {
      ignoradosPorDuplicidade++;
      continue;
    }
    const n = (idxPorDiaCP.get(l.data) ?? 0) + 1;
    idxPorDiaCP.set(l.data, n);
    payload.push({
      unidade_id: unidadeId,
      conta_pagar_id: gerarIdCaixa(l.data, n),
      numero_parcela: '1/1',
      sacado: l.origemDestino || l.complemento || 'Caixa',
      categoria: normalizeCategoria(l.categoria),
      forma_cobranca: 'CAIXA',
      tipo_recebimento: '',
      vencimento: l.data,
      data_pagamento: l.data,
      valor_parcela: l.valor,
      valor_pago: l.valor,
      situacao_parcela: 'Pago',
      sincronizado_em: new Date().toISOString(),
    });
  }

  // 4) Insere as ENTRADAS SEM ALUNO em etp_contas_receber como "Outras
  //    Entradas". O sacado guarda a descrição disponível (complemento, ex.:
  //    "Clínica Escola", ou a categoria original do caixa) para rastreio.
  const idxPorDiaCR = new Map<string, number>();
  const payloadCR: Array<Record<string, unknown>> = [];
  for (const l of entradasSemAluno) {
    const n = (idxPorDiaCR.get(l.data) ?? 0) + 1;
    idxPorDiaCR.set(l.data, n);
    payloadCR.push({
      unidade_id: unidadeId,
      conta_receber_id: gerarIdCaixa(l.data, n),
      numero_parcela: '1/1',
      sacado: l.complemento || normalizeCategoria(l.categoria) || 'Caixa',
      categoria: CATEGORIA_OUTRAS_ENTRADAS,
      forma_cobranca: 'CAIXA',
      tipo_recebimento: '',
      vencimento: l.data,
      data_pagamento: l.data,
      valor_parcela: l.valor,
      valor_pago: l.valor,
      situacao_parcela: 'Recebida',
      sincronizado_em: new Date().toISOString(),
    });
  }

  // Lotes de 500
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const slice = payload.slice(i, i + BATCH);
    const { error } = await supabase
      .from('etp_contas_pagar')
      .upsert(slice, { onConflict: 'unidade_id,conta_pagar_id,numero_parcela' });
    if (error) throw error;
  }
  for (let i = 0; i < payloadCR.length; i += BATCH) {
    const slice = payloadCR.slice(i, i + BATCH);
    const { error } = await supabase
      .from('etp_contas_receber')
      .upsert(slice, { onConflict: 'unidade_id,conta_receber_id,numero_parcela' });
    if (error) throw error;
  }

  // 5) Registra cada dia do periodo importado em etp_sync_dias com tipo='caixa'.
  //    Inclui dias sem movimento (registros=0) — o PDF cobre o periodo inteiro,
  //    entao todos os dias estao "auditados" mesmo que sem lancamentos. Assim o
  //    mapa de status mostra "30/30" quando o mes foi importado.
  //    A contagem reflete o que foi EFETIVAMENTE inserido (apos dedup), CP + CR.
  const contagemPorDia = new Map<string, number>();
  for (const row of [...payload, ...payloadCR]) {
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
  await SyncDiasAPI.registrarBatch(unidadeId, diasPeriodo, 'caixa');

  return {
    inseridos: payload.length,
    inseridosOutrasEntradas: payloadCR.length,
    entradasComAlunoIgnoradas,
    removidosAntesDeInserir,
    ignoradosPorDuplicidade,
  };
}
