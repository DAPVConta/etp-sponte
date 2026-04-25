// Parser do relatório "Fluxo de Caixa" do Sponte (PDF exportado do SPRel/ReportViewer)
// Extrai: nome da unidade, período (início/fim) e os lançamentos (data, categoria, E/S, valor).
//
// pdfjs-dist é carregado dinamicamente dentro de parseFluxoCaixaPDF para que o
// chunk pesado (>1MB do worker + lib) saia do bundle principal e só seja baixado
// quando o usuário abrir o modal de importação.

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
  dataRep: string;       // YYYY-MM-DD
  categoria: string;
  tipo: 'E' | 'S';
  origemDestino: string;
  valor: number;         // absoluto (positivo)
}

export interface FluxoCaixaRelatorio {
  unidadeNome: string;   // ex: "ETP - Vitória"
  periodoInicio: string; // YYYY-MM-DD
  periodoFim: string;    // YYYY-MM-DD
  lancamentos: FluxoCaixaLancamento[];
  totalRegistros: number;
  totalSaidas: number;
  totalEntradas: number;
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

// Agrupa items de texto do pdfjs por linha (mesmo y, tolerância)
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

export async function parseFluxoCaixaPDF(file: File): Promise<FluxoCaixaRelatorio> {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const allItems: TextItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str || !it.str.trim()) continue;
      allItems.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
    }
  }

  const lines = groupByLine(allItems);
  const rawLines = lines.map(l => l.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());

  // Em PDFs do Sponte, dois lançamentos podem ser agrupados na mesma linha (mesmo Y
  // dentro da tolerância). Detectamos múltiplos pares "DD/MM/YYYY DD/MM/YYYY" numa
  // mesma linha e quebramos em sublinhas — caso contrário a regex só casa o primeiro
  // par e o resto vira lixo na categoria (ex.: "10/04/2026 09/03/2026 Taxa Pix...").
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

  // Descobre nome da unidade — texto próximo ao topo, tipicamente "ETP - <algo>"
  let unidadeNome = '';
  for (const t of textLines.slice(0, 10)) {
    const m = t.match(/\b(ETP\s*[-–]\s*[^\|]+?)(?=$|\s{2}|Fluxo|P[aá]gina)/i);
    if (m) { unidadeNome = m[1].trim(); break; }
  }
  if (!unidadeNome) {
    for (const t of textLines.slice(0, 20)) {
      if (/^[A-ZÀ-Ú][A-Za-zÀ-ú0-9 .\-]{2,40}$/.test(t.trim()) && !/Fluxo|P[aá]gina|Per[ií]odo|Data|Saldo|Resumo|Categoria|Entradas|Sa[ií]das/i.test(t)) {
        unidadeNome = t.trim();
        break;
      }
    }
  }

  // Período
  let periodoInicio = '', periodoFim = '';
  for (const t of textLines) {
    const m = t.match(/Per[ií]odo[^:]*:\s*(\d{2}\/\d{2}\/\d{4})\s*(?:e|a|\-)\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (m) { periodoInicio = ptBRtoISO(m[1]); periodoFim = ptBRtoISO(m[2]); break; }
  }

  // Lançamentos: linhas começando com DD/MM/YYYY DD/MM/YYYY ...
  // Na linha: [Data] [DataRep] [Categoria com possíveis espaços/parênteses] [E|S] [Origem/Destino opcional] [Detalhes opcional] [Valor] [Saldo]
  //
  // A categoria pode quebrar em duas linhas no PDF (ex: "Outros (Despesas" / "Variaveis)"). O pdfjs agrupa por Y, então
  // quando a segunda linha tem só "Variaveis)" sem data, anexamos à linha anterior.
  const rowRx = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;
  const lancamentos: FluxoCaixaLancamento[] = [];
  let pendingCategoriaAppend: FluxoCaixaLancamento | null = null;

  for (const t of textLines) {
    const m = t.match(rowRx);
    if (!m) {
      // Se for a continuação da categoria anterior (não começa com data e contém texto típico)
      if (pendingCategoriaAppend && /^[A-Za-zÀ-ú\s\(\)]+\)?$/.test(t.trim()) && t.trim().length < 60
          && !/^(Resumo|P[aá]gina|Per[ií]odo|Total|Entradas|Sa[ií]das|Saldo)/i.test(t.trim())) {
        pendingCategoriaAppend.categoria = (pendingCategoriaAppend.categoria + ' ' + t.trim()).replace(/\s+/g, ' ');
        pendingCategoriaAppend = null;
      }
      continue;
    }
    const [, data, dataRep, resto] = m;

    // Extrai valor + saldo do final: dois números pt-BR (com sinal opcional)
    const valsRx = /(-?[\d.]*\d,\d{2})\s+(-?[\d.]*\d,\d{2})\s*$/;
    const vm = resto.match(valsRx);
    if (!vm) continue;
    const valorRaw = vm[1];
    const miolo = resto.slice(0, resto.length - vm[0].length).trim();

    // E/S é um token isolado "S" ou "E"
    const tipoRx = /\s+([ES])(?:\s+|$)/;
    const tm = miolo.match(tipoRx);
    let categoria = miolo;
    let tipo: 'E' | 'S' = 'S';
    let origemDestino = '';
    if (tm) {
      const idx = miolo.indexOf(tm[0]);
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
    // Categoria pode ser complementada na linha seguinte (caso de quebra)
    pendingCategoriaAppend = /\($/.test(categoria) || /\(/.test(categoria) && !/\)/.test(categoria) ? row : null;
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
