// Parsers compartilhados para respostas XML da API Sponte (WSAPIEdu).
//
// Hoje CP (ConfiguracoesSyncPage/DashboardPage/CategoriasPage) duplica seus
// parsers inline. Este modulo centraliza os de CR e pode absorver os de CP
// em uma etapa futura de limpeza, sem alargar o escopo deste PR.

import type { CategoriaDespesa, CategoriaReceita, ParcelaReceber } from '../types';

// ── Helpers basicos ─────────────────────────────────────────────────────────
const parseNumericPtBR = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const getText = (node: Element, tag: string): string =>
  node.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';

const parseXml = (xmlString: string): Document | null => {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  if (doc.querySelector('parsererror')) return null;
  return doc;
};

// ── Categorias (mesmo schema para receitas e despesas) ─────────────────────
// Ambos endpoints retornam ArrayOfWsCategorias -> wsCategorias -> Categorias
// com CategoriaID + Nome. A unica diferenca e o nome da operacao.
function parseCategoriasBase<T extends { categoriaID: number; nome: string }>(
  xmlString: string,
  build: (id: number, nome: string) => T,
): T[] {
  const doc = parseXml(xmlString);
  if (!doc) return [];

  const result: T[] = [];
  for (const node of Array.from(doc.getElementsByTagName('Categorias'))) {
    const id = parseInt(getText(node, 'CategoriaID') || '0', 10);
    const nome = getText(node, 'Nome');
    if (id > 0 && nome) result.push(build(id, nome));
  }
  return result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Parser da resposta de GetCategorias (receitas/mensalidades). */
export const parseCategoriasReceitasXML = (xml: string): CategoriaReceita[] =>
  parseCategoriasBase(xml, (categoriaID, nome) => ({ categoriaID, nome }));

/** Parser da resposta de GetCategoriasDespesas (mantido para paridade/uso futuro). */
export const parseCategoriasDespesasXML = (xml: string): CategoriaDespesa[] =>
  parseCategoriasBase(xml, (categoriaID, nome) => ({ categoriaID, nome }));

// ── Parcelas a receber (wsParcela de GetParcelas) ──────────────────────────
const PARCELA_RECEBER_STR_FIELDS = [
  'ContaReceberID', 'NumeroParcela', 'Sacado', 'SituacaoParcela', 'SituacaoCNAB',
  'Vencimento', 'Categoria', 'ContaID', 'AlunoID', 'FaturaID', 'NumeroBoleto',
  'TipoRecebimento', 'FormaCobranca', 'BolsaAssociada', 'DataPagamento',
  'RetornoOperacao',
] as const;

const PARCELA_RECEBER_NUM_FIELDS = ['ValorParcela', 'ValorPago'] as const;

/** Parser da resposta de GetParcelas (contas a receber/mensalidades). */
export const parseParcelasReceberXML = (xmlString: string): ParcelaReceber[] => {
  const doc = parseXml(xmlString);
  if (!doc) return [];

  return Array.from(doc.getElementsByTagName('wsParcela')).map(item => {
    const record: Record<string, string | number> = {};
    for (const f of PARCELA_RECEBER_STR_FIELDS) record[f] = getText(item, f);
    for (const f of PARCELA_RECEBER_NUM_FIELDS) record[f] = parseNumericPtBR(getText(item, f));
    return record as unknown as ParcelaReceber;
  });
};
