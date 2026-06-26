// Parser do relatorio "Relação de Contas Pagas" / "Relação de Contas Recebidas"
// do sistema das unidades Qualitrainer (Paulista e Goiana).
//
// Diferente dos relatorios de Caixa do Sponte (ver pdf-fluxo-caixa.ts), este
// relatorio lista CADA lancamento individualmente, agrupado pelo plano de
// contas (Grupo > Subcategoria). Layout em colunas de largura fixa:
//
//   Nº Lanç. | Fornecedor/Funcionário | Banco | Histórico | Venc. | Data Pgto. | Valor Pago
//   x≈10       x≈58                     x≈285   x≈420       x≈644   x≈698        x≈775+
//
// Os cabecalhos de Grupo (ex.: "DESPESAS FIXAS") e de Subcategoria (ex.:
// "ALUGUEL") ficam sozinhos na coluna da esquerda (x<55). A regra de
// hierarquia: um cabecalho seguido DIRETAMENTE por um registro e a
// subcategoria (folha do plano de contas); quando dois cabecalhos se empilham
// sem registro entre eles, o primeiro e o Grupo.
//
// IMPORTANTE: a subcategoria (folha) e detectada de forma 100% confiavel — e
// sempre o ultimo cabecalho imediatamente antes do registro. O Grupo e
// "melhor esforco" (usado apenas no preview, nunca persistido).
//
// pdfjs-dist e carregado sob demanda (chunk pesado fora do bundle principal).

type PdfJsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJsModule> | null = null;
async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, workerUrlMod] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      lib.GlobalWorkerOptions.workerSrc = (workerUrlMod as { default: string }).default;
      return lib;
    })();
  }
  return pdfjsPromise;
}

export type TipoRelatorio = 'pagar' | 'receber';

export interface RelacaoContaItem {
  numeroLanc: number;     // Nº Lanç. (= ContaPagarID/ContaReceberID no sistema de origem)
  fornecedor: string;     // Fornecedor/Funcionário (pagar) ou Sacado/Cliente (receber)
  banco: string;
  historico: string;
  grupo: string;          // categoria nivel 1 (melhor esforco, apenas para exibicao)
  categoria: string;      // subcategoria nivel 2 = folha do plano de contas (persistida)
  vencimento: string;     // ISO YYYY-MM-DD
  dataPagamento: string;  // ISO YYYY-MM-DD (data de pagamento/recebimento)
  valor: number;          // valor pago/recebido (positivo)
}

export interface RelacaoContasRelatorio {
  tipo: TipoRelatorio;
  periodoInicio: string;  // ISO
  periodoFim: string;     // ISO
  itens: RelacaoContaItem[];
  totalRegistros: number;
  totalValor: number;
}

export class UnsupportedReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedReportError';
  }
}

interface TextItem { str: string; x: number; y: number; }
interface Line { page: number; y: number; items: TextItem[]; }

const ptBRtoISO = (s: string): string => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const parseNumPtBR = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
};

// Os dois relatorios tem layouts de coluna DIFERENTES:
//   - "Contas Pagas":     Nº | Fornecedor | Banco | Histórico | Venc | Data Pgto | Valor
//   - "Contas Recebidas": Nº | Aluno      | Banco | Venc | Data Pgto | Valor  (sem Histórico,
//                         colunas mais a esquerda)
// Por isso as colunas sao detectadas dinamicamente a partir do cabecalho (ver
// detectarColunas); o layout fixo abaixo e apenas fallback (Contas Pagas).
type ColKey = 'num' | 'forn' | 'banco' | 'hist' | 'venc' | 'pgto' | 'valor';
type ColRanges = Partial<Record<ColKey, { min: number; max: number }>>;

const COL_FALLBACK: ColRanges = {
  num:    { min:   0, max:  55 },
  forn:   { min:  55, max: 280 },
  banco:  { min: 280, max: 415 },
  hist:   { min: 415, max: 635 },
  venc:   { min: 635, max: 688 },
  pgto:   { min: 688, max: 758 },
  valor:  { min: 758, max: 9999 },
};

function colOf(x: number, COL: ColRanges): ColKey | null {
  for (const k of Object.keys(COL) as ColKey[]) {
    const r = COL[k]!;
    if (x >= r.min && x < r.max) return k;
  }
  return null;
}

// Labels do cabecalho -> coluna. A ordem importa (primeiro match vence).
const COL_LABELS: Array<[ColKey, RegExp]> = [
  ['num',   /^N[ºo]\.?\s*Lan[çc]/i],
  ['forn',  /(Fornecedor|Aluno|Sacado|Cliente)/i],
  ['banco', /^Banco$/i],
  ['hist',  /^Hist[óo]rico$/i],
  ['venc',  /^Venc/i],
  ['pgto',  /^Data\s+(Pgto|Rec)/i],
  ['valor', /^Valor\s+(Pago|Recebido)/i],
];

// Le os anchors X dos labels na linha-cabecalho (a que casa mais labels) e
// constroi as faixas de cada coluna usando o PONTO MEDIO entre anchors vizinhos
// — robusto a valores monetarios alinhados a direita (que comecam mais a
// esquerda quanto maiores). Retorna null se achar menos de 4 labels.
function detectarColunas(lines: Line[]): ColRanges | null {
  let best: { score: number; anchors: Partial<Record<ColKey, number>> } = { score: 0, anchors: {} };
  for (const ln of lines) {
    const anchors: Partial<Record<ColKey, number>> = {};
    for (const it of ln.items) {
      for (const [col, rx] of COL_LABELS) {
        if (anchors[col] === undefined && rx.test(it.str)) { anchors[col] = it.x; break; }
      }
    }
    const score = Object.keys(anchors).length;
    if (score > best.score) best = { score, anchors };
  }
  if (best.score < 4) return null;
  const xs = (Object.entries(best.anchors) as Array<[ColKey, number]>).sort((a, b) => a[1] - b[1]);
  const mid = (a: number, b: number) => (a + b) / 2;
  const ranges: ColRanges = {};
  for (let i = 0; i < xs.length; i++) {
    const [col, x] = xs[i];
    const min = i === 0 ? 0 : mid(xs[i - 1][1], x);
    const max = i === xs.length - 1 ? 9999 : mid(x, xs[i + 1][1]);
    ranges[col] = { min, max };
  }
  return ranges;
}

const DATE_RX = /\d{2}\/\d{2}\/\d{4}/;
// Linhas a ignorar (totais, cabecalho de colunas, rodape, titulo).
const SKIP_RX = /^(N[ºo]\s*Registros|Total\s+Pago|Total\s+Recebido|Total\s+Provisionado|Total\b|Totais|Rela[çc][ãa]o|Per[ií]odo|P[áa]g\b|N[ºo]\s*Lan[çc]|Fornecedor\/|Sacado|Cliente|Banco|Hist[óo]rico|Venc|Data\s+Pgto|Data\s+Rec|Valor\s+(Pago|Recebido))/i;

async function extractLines(file: File): Promise<{ lines: Line[]; head: string }> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const all: TextItem[] = [];
  const perPage: TextItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of tc.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str || !it.str.trim()) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] });
    }
    perPage[p] = items;
    all.push(...items);
  }

  // Agrupa por (pagina, Y) com tolerancia. Paginas nunca se misturam.
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const items = (perPage[p] ?? []).slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && last.page === p && Math.abs(last.y - it.y) <= 2.5) {
        last.items.push(it);
      } else {
        lines.push({ page: p, y: it.y, items: [it] });
      }
    }
  }
  for (const ln of lines) ln.items.sort((a, b) => a.x - b.x);

  // Cabecalho (primeiras linhas da pagina 1) para detectar tipo e periodo.
  const head = lines.filter(l => l.page === 1).slice(0, 12)
    .map(l => l.items.map(i => i.str).join(' ')).join(' | ');

  return { lines, head };
}

function detectarTipo(head: string): TipoRelatorio | null {
  if (/Rela[çc][ãa]o\s+de\s+Contas\s+Pagas/i.test(head)) return 'pagar';
  if (/Rela[çc][ãa]o\s+de\s+Contas\s+Recebidas/i.test(head)) return 'receber';
  // Fallbacks por coluna de valor
  if (/Valor\s+Pago/i.test(head)) return 'pagar';
  if (/Valor\s+Recebido/i.test(head)) return 'receber';
  return null;
}

function findPeriodo(head: string): { inicio: string; fim: string } {
  // "Período de 01/05/2026 até 31/05/2026"
  let m = head.match(/Per[ií]odo\s+de\s+(\d{2}\/\d{2}\/\d{4})\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (!m) {
    // Fallback generico: "...: X a/e/- Y"
    m = head.match(/Per[ií]odo[^:]*:?\s*(\d{2}\/\d{2}\/\d{4})\s*(?:a|e|at[ée]|-)\s*(\d{2}\/\d{2}\/\d{4})/i);
  }
  if (m) return { inicio: ptBRtoISO(m[1]), fim: ptBRtoISO(m[2]) };
  return { inicio: '', fim: '' };
}

export async function parseRelacaoContasPDF(file: File): Promise<RelacaoContasRelatorio> {
  const { lines, head } = await extractLines(file);

  const tipo = detectarTipo(head);
  if (!tipo) {
    throw new UnsupportedReportError(
      'Formato nao reconhecido. Envie o PDF do relatorio "Relação de Contas Pagas" ' +
      'ou "Relação de Contas Recebidas".'
    );
  }

  const { inicio: periodoInicio, fim: periodoFim } = findPeriodo(head);

  // Detecta as colunas pelo cabecalho (fallback = layout Contas Pagas).
  const COL: ColRanges = detectarColunas(lines) ?? COL_FALLBACK;
  const numMax = COL.num?.max ?? 55;

  const itens: RelacaoContaItem[] = [];
  let pend: string[] = [];   // cabecalhos acumulados desde o ultimo registro
  let grupo = '';
  let categoria = '';

  // Concatena, por coluna, todos os items de uma linha (pdfjs pode fragmentar
  // um mesmo campo — ex.: "R$" e "6049,00" — em items separados).
  const colText = (its: TextItem[], col: ColKey): string =>
    its.filter(i => colOf(i.x, COL) === col).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();

  for (const ln of lines) {
    const its = ln.items;
    if (its.length === 0) continue;
    const valorStr = colText(its, 'valor');
    const numItem = its.find(i => i.x < numMax && /^\d+$/.test(i.str.replace(/\D/g, '')) && /\d/.test(i.str));
    const hasValor = /\d,\d{2}/.test(valorStr);

    // ── REGISTRO ──────────────────────────────────────────────
    if (numItem && hasValor) {
      if (pend.length > 0) {
        categoria = pend[pend.length - 1];
        if (pend.length >= 2) grupo = pend[0];
        pend = [];
      }
      const vencStr = colText(its, 'venc');
      const pgtoStr = colText(its, 'pgto');
      const rec: RelacaoContaItem = {
        numeroLanc: parseInt(numItem.str.replace(/\D/g, ''), 10),
        fornecedor: colText(its, 'forn'),
        banco: colText(its, 'banco'),
        historico: colText(its, 'hist'),
        grupo, categoria,
        vencimento: DATE_RX.test(vencStr) ? ptBRtoISO(vencStr) : '',
        dataPagamento: DATE_RX.test(pgtoStr) ? ptBRtoISO(pgtoStr) : '',
        valor: parseNumPtBR(valorStr),
      };
      // Data de pagamento e a ancora do "realizado"; se faltar, usa vencimento.
      if (!rec.dataPagamento) rec.dataPagamento = rec.vencimento;
      if (rec.valor > 0 && rec.dataPagamento) itens.push(rec);
      continue;
    }

    // ── CABECALHO (Grupo ou Subcategoria) ─────────────────────
    // Linha que comeca na coluna da esquerda, alfabetica, fora da lista de skip
    // e sem valor monetario (registros ja foram tratados acima).
    if (its[0].x < numMax) {
      const txt = its.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (txt && !SKIP_RX.test(txt) && /[A-Za-zÀ-ú]/.test(txt) && !/^\d/.test(txt)) {
        pend.push(txt);
      }
    }
    // Demais linhas (totais, "Nº Registros", rodape) sao ignoradas.
  }

  if (itens.length === 0) {
    throw new UnsupportedReportError(
      'Nenhum lancamento encontrado no relatorio. Verifique se o PDF e o ' +
      '"Relação de Contas Pagas/Recebidas" correto.'
    );
  }

  const totalValor = itens.reduce((s, i) => s + i.valor, 0);

  return {
    tipo,
    periodoInicio,
    periodoFim,
    itens,
    totalRegistros: itens.length,
    totalValor,
  };
}
