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

// Tenta identificar o periodo "DD/MM/YYYY .. DD/MM/YYYY" no texto
function findPeriodo(rawLines: string[]): { inicio: string; fim: string } {
  for (const t of rawLines) {
    const m = t.match(/Per[ií]odo[^:]*:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:e|a|\-)\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m) return { inicio: ptBRtoISO(m[1]), fim: ptBRtoISO(m[2]) };
  }
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
function parseLancamentosCaixa(pages: PageItems[]): FluxoCaixaLancamento[] {
  // Coordenadas X de referencia para cada coluna (descobertas via inspecao do
  // PDF). Tolerancia generosa para acomodar pequenas variacoes entre Sponte
  // versions: largura util ~50px por coluna.
  const COL = {
    data:       { min:   0, max:  90 },
    origem:     { min:  90, max: 260 },
    categoria:  { min: 260, max: 430 },
    valor:      { min: 430, max: 490 },
    tipo:       { min: 490, max: 545 },
    complemento:{ min: 545, max: 999 },
  };

  // Regex da data (anchor de cada row)
  const DATE_RX = /^\d{2}\/\d{2}\/\d{4}$/;

  const lancamentos: FluxoCaixaLancamento[] = [];

  for (const page of pages) {
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
// Detector de formato + entry point
// =============================================================================

type Formato = 'fluxo-caixa' | 'lancamentos-caixa' | 'desconhecido';

function detectarFormato(pages: PageItems[]): Formato {
  const head = pages[0]?.rawLines.slice(0, 30).join(' | ') ?? '';
  if (/Lan[çc]amentos\s+do\s+Caixa/i.test(head)) return 'lancamentos-caixa';
  if (/Fluxo\s+de\s+Caixa/i.test(head)) return 'fluxo-caixa';
  // Fallback: se tem cabecalho com "Saldo" e "Data Rep", e formato A.
  if (/Data\s+Rep|Saldo/i.test(head)) return 'fluxo-caixa';
  // Se tem "Tipo de Movimenta" ou "Lancamento" como cabecalho, e formato B.
  if (/Tipo\s+de\s+Movimenta|Data\s+Lan[çc]amento/i.test(head)) return 'lancamentos-caixa';
  return 'desconhecido';
}

export async function parseFluxoCaixaPDF(file: File): Promise<FluxoCaixaRelatorio> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const pages = await extractPages(pdf);
  const formato = detectarFormato(pages);

  if (formato === 'desconhecido') {
    throw new UnsupportedReportError(
      'Formato de PDF nao reconhecido. Por favor, exporte o relatorio "Lancamentos do Caixa" em ' +
      'https://www.sponteeducacional.net.br/SPRel/Financeiro/Lancamentos.aspx ' +
      '(Financeiro > Relatorios > Lancamentos do Caixa).'
    );
  }

  const lancamentos = formato === 'lancamentos-caixa'
    ? parseLancamentosCaixa(pages)
    : parseFluxoCaixa(pages);

  // Metadados (unidade + periodo) via heuristica simples sobre todas as
  // rawLines do PDF — ambos os formatos colocam isso no rodape de cada pagina.
  const allRawLines = pages.flatMap(p => p.rawLines);
  const unidadeNome = findUnidadeNome(allRawLines);
  const { inicio: periodoInicio, fim: periodoFim } = findPeriodo(allRawLines);

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
