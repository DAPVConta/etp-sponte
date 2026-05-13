// Parser de PDF dos relatorios de caixa do Sponte. Suporta DOIS formatos:
//
//   A) "Fluxo de Caixa"          (SPRel/Financeiro/FluxoDeCaixa.aspx — legado)
//      Colunas: Data | Data Rep | Categoria | E/S | Origem/Destino | ... | Valor | Saldo
//
//   B) "Lancamentos do Caixa"    (SPRel/Financeiro/Lancamentos.aspx)
//      Colunas: Data Lancamento | Origem/Destino | Categoria | Valor | Tipo de Movimentacao | Complemento
//
// Quando nenhum dos dois layouts e detectado, lancamos UnsupportedReportError com
// uma mensagem orientando o usuario a emitir o relatorio correto.
//
// pdfjs-dist e carregado dinamicamente para que o chunk pesado (>1MB do worker
// + lib) saia do bundle principal e so seja baixado quando o usuario abrir o
// modal de importacao.

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

export interface FluxoCaixaLancamento {
  data: string;          // YYYY-MM-DD
  dataRep: string;       // YYYY-MM-DD (= data quando o formato nao tem)
  categoria: string;
  tipo: 'E' | 'S';
  origemDestino: string;
  valor: number;         // absoluto (positivo)
}

export interface FluxoCaixaRelatorio {
  unidadeNome: string;   // ex: "ETP - Vitoria"
  periodoInicio: string; // YYYY-MM-DD
  periodoFim: string;    // YYYY-MM-DD
  lancamentos: FluxoCaixaLancamento[];
  totalRegistros: number;
  totalSaidas: number;
  totalEntradas: number;
}

export class UnsupportedReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedReportError';
  }
}

interface TextItem {
  str: string;
  x: number;
  y: number;
}

const ptBRtoISO = (s: string): string => {
  const [dd, mm, yyyy] = s.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

const parseNumPtBR = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

// Agrupa items de texto do pdfjs por linha (mesmo y, tolerancia)
function groupByLine(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines: TextItem[][] = [];
  const TOL = 2;
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= TOL) {
      last.push(it);
    } else {
      lines.push([it]);
    }
  }
  for (const ln of lines) ln.sort((a, b) => a.x - b.x);
  return lines;
}

interface PageItems {
  items: TextItem[];
  lines: TextItem[][];
  rawLines: string[];
}

async function extractPages(pdf: Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>): Promise<PageItems[]> {
  const out: PageItems[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of tc.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
    }
    const lines = groupByLine(items);
    const rawLines = lines.map(l => l.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
    out.push({ items, lines, rawLines });
  }
  return out;
}

// Tenta identificar o nome da unidade ("ETP - <algo>") nas primeiras linhas
function findUnidadeNome(rawLines: string[]): string {
  for (const t of rawLines.slice(0, 25)) {
    const m = t.match(/\b(ETP\s*[-–]\s*[^\|]+?)(?=$|\s{2}|Fluxo|Lan[çc]amento|P[aá]gina)/i);
    if (m) return m[1].trim();
  }
  return '';
}

// Tenta identificar o periodo "DD/MM/YYYY .. DD/MM/YYYY" no texto.
// Aceita as 3 variacoes que aparecem nos relatorios do Sponte:
//   "Periodo do Lancamento entre: X e Y"  (Lancamentos do Caixa, Fluxo de Caixa)
//   "Data de Pagamento entre: X e Y"      (Plano de Contas)
//   "Periodo: X a Y"                       (formato generico)
//
// O texto pode quebrar em duas linhas (ex.: "...entre: 01/01/2026 e\n31/01/2026."),
// entao concatenamos todas as rawLines em uma unica string para o regex.
function findPeriodo(rawLines: string[]): { inicio: string; fim: string } {
  const blob = rawLines.join(' ');
  const m = blob.match(/(?:Per[ií]odo[^:]*|Data\s+de\s+Pagamento)[^:]*:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:e|a|\-)\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (m) return { inicio: ptBRtoISO(m[1]), fim: ptBRtoISO(m[2]) };
  return { inicio: '', fim: '' };
}

// =============================================================================
// FORMATO A: "Fluxo de Caixa" (SPRel/Financeiro/FluxoDeCaixa.aspx)
// =============================================================================

function parseFluxoCaixa(pages: PageItems[]): FluxoCaixaLancamento[] {
  // Concatena rawLines de todas as paginas (cada pagina ja agrupada por Y
  // independentemente — items de paginas distintas nunca sao misturados).
  const rawLines = pages.flatMap(p => p.rawLines);

  // Em PDFs do Sponte, dois lancamentos podem ser agrupados na mesma linha
  // (mesmo Y dentro da tolerancia). Detectamos multiplos pares
  // "DD/MM/YYYY DD/MM/YYYY" numa mesma linha e quebramos em sublinhas.
  const ROW_START_RX = /\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}/g;
  const textLines: string[] = [];
  for (const t of rawLines) {
    const matches = [...t.matchAll(ROW_START_RX)];
    if (matches.length <= 1) { textLines.push(t); continue; }
    if ((matches[0].index ?? 0) > 0) textLines.push(t.slice(0, matches[0].index).trim());
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? t.length) : t.length;
      textLines.push(t.slice(start, end).trim());
    }
  }

  // Cada linha valida: DD/MM/YYYY DD/MM/YYYY <categoria> <E|S> [origem] <valor> <saldo>
  const rowRx = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;
  const valsRx = /(-?[\d.]*\d,\d{2})\s+(-?[\d.]*\d,\d{2})\s*$/;
  const tipoRx = /\s+([ES])(?:\s+|$)/;

  const lancamentos: FluxoCaixaLancamento[] = [];
  let pendingCategoriaAppend: FluxoCaixaLancamento | null = null;

  for (const t of textLines) {
    const m = t.match(rowRx);
    if (!m) {
      // Continuacao de categoria com parenteses abertos (ex.: "Outros (Despesas Variaveis)")
      if (pendingCategoriaAppend && /^[A-Za-zÀ-ú\s\(\)]+\)?$/.test(t.trim()) && t.trim().length < 60
          && !/^(Resumo|P[aá]gina|Per[ií]odo|Total|Entradas|Sa[ií]das|Saldo)/i.test(t.trim())) {
        pendingCategoriaAppend.categoria = (pendingCategoriaAppend.categoria + ' ' + t.trim()).replace(/\s+/g, ' ');
        pendingCategoriaAppend = null;
      }
      continue;
    }
    const [, data, dataRep, resto] = m;
    const vm = resto.match(valsRx);
    if (!vm) continue;
    const valorRaw = vm[1];
    const miolo = resto.slice(0, resto.length - vm[0].length).trim();
    const tm = miolo.match(tipoRx);
    let categoria = miolo;
    let tipo: 'E' | 'S' = 'S';
    let origemDestino = '';
    if (tm) {
      // tm.index = posicao real do match (NAO usar indexOf que falha em
      // categorias com " S" ou " E" embutido, ex.: "Taxa Pix Sponte Pay").
      const idx = tm.index ?? 0;
      categoria = miolo.slice(0, idx).trim();
      tipo = tm[1] as 'E' | 'S';
      origemDestino = miolo.slice(idx + tm[0].length).trim();
    }

    const valor = Math.abs(parseNumPtBR(valorRaw));
    const row: FluxoCaixaLancamento = {
      data: ptBRtoISO(data),
      dataRep: ptBRtoISO(dataRep),
      categoria,
      tipo,
      origemDestino,
      valor,
    };
    lancamentos.push(row);
    pendingCategoriaAppend = /\($/.test(categoria) || /\(/.test(categoria) && !/\)/.test(categoria) ? row : null;
  }

  return lancamentos;
}

// =============================================================================
// FORMATO B: "Lancamentos do Caixa" (SPRel/Financeiro/Lancamentos.aspx)
// =============================================================================
//
// Layout (X aproximado): Data Lancamento (~30) | Origem/Destino (~101) |
// Categoria (~271) | Valor (~441) | Tipo de Movimentacao (~498) | Complemento (~554)
//
// Cada linha de lancamento tem todos os campos no MESMO Y; o "Tipo de
// Movimentacao" pode quebrar em duas linhas ("Pix Sponte" + "Pay") com Y
// um pouco menor, mas a data — nossa ancora — sempre fica em uma unica linha.
//
// O total geral aparece numa linha final apenas com valor preenchido em X=441
// e a contagem aparece como "Total de Registros: N".
type ColRanges = {
  data:       { min: number; max: number };
  origem:     { min: number; max: number };
  categoria:  { min: number; max: number };
  valor:      { min: number; max: number };
  tipo:       { min: number; max: number };
  complemento:{ min: number; max: number };
};

// Coordenadas X de fallback (layout "padrao" do Sponte que servia ate descobrirmos
// que algumas unidades exportam com larguras diferentes — ex.: Gravata empurra
// Valor para X~555 em vez de X~441). Usado apenas se nao acharmos cabecalho.
const COL_FALLBACK: ColRanges = {
  data:       { min:   0, max:  90 },
  origem:     { min:  90, max: 260 },
  categoria:  { min: 260, max: 430 },
  valor:      { min: 430, max: 490 },
  tipo:       { min: 490, max: 545 },
  complemento:{ min: 545, max: 999 },
};

// Le as posicoes X dos labels do cabecalho ("Data", "Origem/Destino", "Categoria",
// "Valor", "Tipo de", "Complemento") e infere os ranges de cada coluna como
// [anchorX, proximoAnchorX). Retorna null se nao achar pelo menos 4 dos 6 labels.
function detectarColunasLancamentos(page: PageItems): ColRanges | null {
  // Agrupa items por Y arredondado e procura a linha com mais labels conhecidos.
  const byY = new Map<number, TextItem[]>();
  for (const it of page.items) {
    const y = Math.round(it.y);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y)!.push(it);
  }
  type Anchors = Partial<Record<keyof ColRanges, number>>;
  let best: { score: number; anchors: Anchors } = { score: 0, anchors: {} };
  for (const row of byY.values()) {
    const anchors: Anchors = {};
    for (const it of row) {
      const s = it.str;
      if (anchors.data === undefined && /^Data(\s+Lan[çc]amento)?$/i.test(s)) anchors.data = it.x;
      else if (anchors.origem === undefined && /^Origem\/Destino$/i.test(s)) anchors.origem = it.x;
      else if (anchors.categoria === undefined && /^Categoria$/i.test(s)) anchors.categoria = it.x;
      else if (anchors.valor === undefined && /^Valor$/i.test(s)) anchors.valor = it.x;
      else if (anchors.tipo === undefined && /^Tipo(\s+de)?$/i.test(s)) anchors.tipo = it.x;
      else if (anchors.complemento === undefined && /^Complemento$/i.test(s)) anchors.complemento = it.x;
    }
    const score = Object.keys(anchors).length;
    if (score > best.score) best = { score, anchors };
  }
  if (best.score < 4) return null;
  const a = best.anchors;
  // Para colunas faltantes (raro), interpolamos com o fallback proporcional.
  const xs: Array<[keyof ColRanges, number]> = [];
  (['data','origem','categoria','valor','tipo','complemento'] as const).forEach(k => {
    if (a[k] !== undefined) xs.push([k, a[k]!]);
  });
  xs.sort((p, q) => p[1] - q[1]);
  const ranges: ColRanges = { ...COL_FALLBACK };
  for (let i = 0; i < xs.length; i++) {
    const [k, x] = xs[i];
    const nextX = i + 1 < xs.length ? xs[i + 1][1] : 9999;
    // tolerancia esquerda de 2px: numeros podem comecar levemente antes do anchor
    const min = i === 0 ? 0 : Math.max(0, x - 2);
    ranges[k] = { min, max: nextX };
  }
  return ranges;
}

function parseLancamentosCaixa(pages: PageItems[]): FluxoCaixaLancamento[] {
  // Regex da data (anchor de cada row)
  const DATE_RX = /^\d{2}\/\d{2}\/\d{4}$/;

  const lancamentos: FluxoCaixaLancamento[] = [];

  for (const page of pages) {
    const COL: ColRanges = detectarColunasLancamentos(page) ?? COL_FALLBACK;
    // Junta items por Y com tolerancia 1px. Para cada Y, identificamos qual
    // coluna o item ocupa pelo X e montamos a linha. Items com Y "filho" (Tipo
    // quebrado em "Pay") sao concatenados ao Y anchor (linha imediatamente
    // acima dentro da coluna tipo).
    const sorted = [...page.items].sort((a, b) => (b.y - a.y) || (a.x - b.x));

    type RowRaw = {
      y: number;
      data?: string;
      origem: string[];
      categoria: string[];
      valor?: string;
      tipo: string[];
      complemento: string[];
    };

    const rows: RowRaw[] = [];
    let cur: RowRaw | null = null;
    const ANCHOR_TOL = 1.5;
    const CHILD_TOL = 12; // distancia maxima Y para considerar continuacao do Tipo

    function colOf(x: number): keyof typeof COL | null {
      for (const k of Object.keys(COL) as Array<keyof typeof COL>) {
        const r = COL[k];
        if (x >= r.min && x < r.max) return k;
      }
      return null;
    }

    for (const it of sorted) {
      const col = colOf(it.x);
      if (!col) continue;

      // Data sempre marca o inicio de uma row: cria uma nova RowRaw.
      if (col === 'data' && DATE_RX.test(it.str.trim())) {
        cur = { y: it.y, origem: [], categoria: [], tipo: [], complemento: [] };
        cur.data = it.str.trim();
        rows.push(cur);
        continue;
      }

      // Sem row corrente — ignora (cabecalho ou rodape).
      if (!cur) continue;

      // Mesmo Y (ou muito proximo) → faz parte da row corrente.
      if (Math.abs(cur.y - it.y) <= ANCHOR_TOL) {
        if (col === 'origem') cur.origem.push(it.str);
        else if (col === 'categoria') cur.categoria.push(it.str);
        else if (col === 'valor') cur.valor = it.str.trim();
        else if (col === 'tipo') cur.tipo.push(it.str);
        else if (col === 'complemento') cur.complemento.push(it.str);
        continue;
      }

      // Y abaixo do anchor: continuacao de coluna multi-linha (so Tipo em
      // pratica, mas tratamos os textuais por seguranca). Total de Registros e
      // o "-184,00" final ficam em rows distintas — la a distancia eh > CHILD_TOL.
      if (cur.y - it.y <= CHILD_TOL) {
        if (col === 'origem') cur.origem.push(it.str);
        else if (col === 'categoria') cur.categoria.push(it.str);
        else if (col === 'tipo') cur.tipo.push(it.str);
        else if (col === 'complemento') cur.complemento.push(it.str);
        continue;
      }

      // Caiu fora — fecha a row corrente.
      cur = null;
    }

    for (const r of rows) {
      if (!r.data || !r.valor) continue;
      const valor = parseNumPtBR(r.valor);
      if (valor === 0) continue;
      const isoDate = ptBRtoISO(r.data);
      lancamentos.push({
        data: isoDate,
        dataRep: isoDate,
        categoria: r.categoria.join(' ').replace(/\s+/g, ' ').trim(),
        tipo: valor < 0 ? 'S' : 'E',
        origemDestino: r.origem.join(' ').replace(/\s+/g, ' ').trim(),
        valor: Math.abs(valor),
      });
    }
  }

  return lancamentos;
}

// =============================================================================
// FORMATO C: "Plano de Contas" (SPRel/Financeiro/PlanoDeContas.aspx)
// =============================================================================
//
// Layout: cada categoria ocupa uma linha com 2 items no MESMO Y:
//   X=30      "¯ ¯ ¯ ¯ <Categoria>....................."  (texto + dots de preench.)
//   X≈515     "R$<valor>"                                  (valor right-aligned)
//
// Linhas de total ("Total do sub grupo:", "Total do grupo:", "Total de Despesas:")
// devem ser ignoradas.
//
// Como o PDF so tem totais agregados (sem dia a dia), geramos UM lancamento
// sintetico por categoria, datado no ULTIMO dia do periodo. O usuario fica
// avisado que e um RESUMO (ver UI do modal).
function parsePlanoDeContas(pages: PageItems[], dataAlvoISO: string): FluxoCaixaLancamento[] {
  const lancamentos: FluxoCaixaLancamento[] = [];
  const VAL_RX = /^R\$\s*(-?[\d.,]+)$/;
  // Strip o prefixo de "¯ ¯ ¯ ¯ " (4 ou 6 baras superiores) e o sufixo de pontos.
  const CAT_RX = /^\s*[¯\s]+(.+?)[\s\.]+$/;
  // Linhas a ignorar (totais e cabecalhos)
  const SKIP_RX = /^(Total\s+(do\s+(sub\s+)?grupo|de\s+Despesas)|Plano\s+de\s+Contas|Educacional|P[aá]gina|Tipo:|ETP|Valor\s+Arrecadado)/i;

  for (const page of pages) {
    for (const ln of page.lines) {
      // Procura par {texto a esquerda, valor a direita} no mesmo Y.
      const items = ln.filter(i => i.str.trim());
      if (items.length < 2) continue;

      // Acha o item de valor (R$X,XX) — geralmente o ultimo
      const valItem = items.find(i => VAL_RX.test(i.str.trim()));
      if (!valItem) continue;

      // Acha o item de texto (categoria) — o item mais a esquerda que NAO e o valor
      const txtItem = items.find(i => i !== valItem && i.str.trim().length > 0);
      if (!txtItem) continue;

      const txt = txtItem.str.trim();
      if (SKIP_RX.test(txt)) continue;

      // Extrai categoria e valor
      const cm = txt.match(CAT_RX);
      if (!cm) continue;
      const categoria = cm[1].trim().replace(/\s+/g, ' ');
      if (!categoria || /^Total/i.test(categoria)) continue;

      const vm = valItem.str.trim().match(VAL_RX);
      if (!vm) continue;
      const valor = parseNumPtBR(vm[1]);
      if (valor === 0) continue;

      lancamentos.push({
        data: dataAlvoISO,
        dataRep: dataAlvoISO,
        categoria,
        tipo: 'S',
        origemDestino: 'Resumo Plano de Contas',
        valor: Math.abs(valor),
      });
    }
  }

  return lancamentos;
}

// =============================================================================
// Detector de formato + entry point
// =============================================================================

type Formato = 'fluxo-caixa' | 'lancamentos-caixa' | 'plano-de-contas' | 'desconhecido';

const URL_LANCAMENTOS_CAIXA =
  'https://www.sponteeducacional.net.br/SPRel/Financeiro/Lancamentos.aspx';

function detectarFormato(pages: PageItems[]): Formato {
  const head = pages[0]?.rawLines.slice(0, 30).join(' | ') ?? '';

  // Casos POSITIVOS — relatorios suportados
  if (/Lan[çc]amentos\s+do\s+Caixa/i.test(head)) return 'lancamentos-caixa';
  if (/Fluxo\s+de\s+Caixa/i.test(head)) return 'fluxo-caixa';
  if (/Tipo\s+de\s+Movimenta|Data\s+Lan[çc]amento/i.test(head)) return 'lancamentos-caixa';
  // Fallback do formato legado: cabecalho "Data Rep" / "Saldo" — mas SO se nao
  // tiver marcadores de Plano de Contas, evitando falso positivo.
  if (/Data\s+Rep|\bSaldo\b/i.test(head) && !/Plano\s+de\s+[Cc]ontas/i.test(head)) {
    return 'fluxo-caixa';
  }

  // Caso NEGATIVO conhecido — usuario subiu o PDF errado (Plano de Contas).
  if (/Plano\s+de\s+[Cc]ontas/i.test(head) || /Total\s+do\s+sub\s+grupo/i.test(head)) {
    return 'plano-de-contas';
  }

  return 'desconhecido';
}

const ERROR_FORMATO_DESCONHECIDO =
  'Formato de PDF nao reconhecido. Por favor, exporte um dos relatorios abaixo do Sponte:\n' +
  '• "Lancamentos do Caixa" (granular, recomendado): ' + URL_LANCAMENTOS_CAIXA + '\n' +
  '• "Plano de Contas" (resumo agregado por categoria) — Financeiro > Relatorios > Plano de Contas';

export async function parseFluxoCaixaPDF(file: File): Promise<FluxoCaixaRelatorio> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const pages = await extractPages(pdf);
  const formato = detectarFormato(pages);

  if (formato === 'desconhecido') {
    throw new UnsupportedReportError(ERROR_FORMATO_DESCONHECIDO);
  }

  // Metadados (unidade + periodo) — todos os formatos suportados imprimem isso
  // em algum lugar do rodape ou cabecalho.
  const allRawLines = pages.flatMap(p => p.rawLines);
  const unidadeNome = findUnidadeNome(allRawLines);
  const { inicio: periodoInicio, fim: periodoFim } = findPeriodo(allRawLines);

  let lancamentos: FluxoCaixaLancamento[];
  if (formato === 'lancamentos-caixa') {
    lancamentos = parseLancamentosCaixa(pages);
  } else if (formato === 'plano-de-contas') {
    // Plano de Contas so tem totais agregados por categoria; geramos UM
    // lancamento sintetico por categoria, datado no ULTIMO dia do periodo.
    // (Se nao identificou periodo, usa hoje como fallback.)
    const dataAlvo = periodoFim || new Date().toISOString().slice(0, 10);
    lancamentos = parsePlanoDeContas(pages, dataAlvo);
  } else {
    lancamentos = parseFluxoCaixa(pages);
  }

  // Defesa: se o detector classificou mas o parser nao extraiu nada, o PDF
  // provavelmente nao e o que o detector achou que era.
  if (lancamentos.length === 0) {
    throw new UnsupportedReportError(ERROR_FORMATO_DESCONHECIDO);
  }

  const totalSaidas = lancamentos.filter(l => l.tipo === 'S').reduce((s, l) => s + l.valor, 0);
  const totalEntradas = lancamentos.filter(l => l.tipo === 'E').reduce((s, l) => s + l.valor, 0);

  return {
    unidadeNome,
    periodoInicio,
    periodoFim,
    lancamentos,
    totalRegistros: lancamentos.length,
    totalSaidas,
    totalEntradas,
  };
}

// =============================================================================
// FORMATO D: XML "Lancamentos do Caixa" (export XML do mesmo relatorio)
// =============================================================================
//
// Estrutura: <NewDataSet><Table>...</Table>...</NewDataSet>
// Cada <Table> e um lancamento, com campos: LancamentoID, DataLancamento,
// DataRepasse, NomeEmpresa, Tipo (S/E), Valor (sinalizado), Categoria,
// OrigemDestino, Complemento, Conta, etc.
//
// Vantagens vs PDF: 100% estruturado, sem ambiguidade de layout. Suporta
// periodos de qualquer tamanho (multimes) sem ajuste — a granularidade vem
// das datas dos proprios <Table>.
async function parseLancamentosXML(file: File): Promise<FluxoCaixaRelatorio> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new UnsupportedReportError(
      'XML invalido — nao foi possivel ler o arquivo. Verifique se o arquivo nao esta corrompido.'
    );
  }

  // Tabelas vem com namespace default vazio dependendo do export do Sponte.
  // Usamos getElementsByTagName que ignora namespace.
  const tables = doc.getElementsByTagName('Table');
  if (tables.length === 0) {
    throw new UnsupportedReportError(
      'XML nao contem nenhum lancamento (<Table>). Verifique se o arquivo e o export ' +
      'XML do relatorio "Lancamentos do Caixa" do Sponte.'
    );
  }

  const getText = (el: Element, tag: string): string => {
    const child = el.getElementsByTagName(tag)[0];
    return child?.textContent?.trim() ?? '';
  };

  const lancamentos: FluxoCaixaLancamento[] = [];
  let unidadeNome = '';
  let minData = '';
  let maxData = '';

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];

    // Data: prefere <Data> (DD/MM/YYYY), fallback para <DataRepasse> (ISO)
    const dataPtBR = getText(t, 'Data');
    let dataISO = '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataPtBR)) {
      dataISO = ptBRtoISO(dataPtBR);
    } else {
      const dataRep = getText(t, 'DataRepasse');
      const m = dataRep.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) dataISO = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (!dataISO) continue;

    // Valor: vem com sinal (negativo para saida)
    const valorRaw = getText(t, 'Valor');
    const valorN = parseFloat(valorRaw);
    if (!Number.isFinite(valorN) || valorN === 0) continue;

    // Tipo: vem como S/E. Se ausente, deduz pelo sinal do valor.
    const tipoRaw = getText(t, 'Tipo').toUpperCase();
    const tipo: 'S' | 'E' = tipoRaw === 'E' || tipoRaw === 'S'
      ? (tipoRaw as 'S' | 'E')
      : (valorN < 0 ? 'S' : 'E');

    const categoria = getText(t, 'Categoria');
    if (!categoria) continue;

    // Sacado: prefere OrigemDestino, depois Complemento, depois fallback.
    const origemDestino = getText(t, 'OrigemDestino') || getText(t, 'Complemento') || '';

    // Pega o nome da unidade do primeiro <Table> que tiver NomeEmpresa.
    if (!unidadeNome) {
      const ne = getText(t, 'NomeEmpresa');
      if (ne) unidadeNome = ne;
    }

    lancamentos.push({
      data: dataISO,
      dataRep: dataISO,
      categoria,
      tipo,
      origemDestino,
      valor: Math.abs(valorN),
    });

    if (!minData || dataISO < minData) minData = dataISO;
    if (!maxData || dataISO > maxData) maxData = dataISO;
  }

  if (lancamentos.length === 0) {
    throw new UnsupportedReportError(
      'XML processado mas nenhum lancamento valido encontrado (verifique campos Data, Valor e Categoria).'
    );
  }

  const totalSaidas = lancamentos.filter(l => l.tipo === 'S').reduce((s, l) => s + l.valor, 0);
  const totalEntradas = lancamentos.filter(l => l.tipo === 'E').reduce((s, l) => s + l.valor, 0);

  return {
    unidadeNome,
    periodoInicio: minData,
    periodoFim: maxData,
    lancamentos,
    totalRegistros: lancamentos.length,
    totalSaidas,
    totalEntradas,
  };
}

// =============================================================================
// Dispatcher generico — entry point usado pela UI
// =============================================================================
//
// Detecta o tipo de arquivo (PDF ou XML) pela extensao do nome ou MIME type
// e roteia para o parser correspondente. Tanto PDF quanto XML aceitam
// periodos de QUALQUER tamanho (1 dia, 1 mes, varios meses) — o limite de
// "1 mes" nao existe no parser, e dado pelo filtro que o usuario aplica no
// Sponte ao gerar o relatorio.
export async function parseLancamentosFile(file: File): Promise<FluxoCaixaRelatorio> {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  const isXml = name.endsWith('.xml') || type === 'application/xml' || type === 'text/xml';
  if (isXml) return parseLancamentosXML(file);
  return parseFluxoCaixaPDF(file);
}
