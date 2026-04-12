// ─────────────────────────────────────────────
// Shared application types
// ─────────────────────────────────────────────

export interface Unidade {
  id: string;
  cnpj: string;
  nome: string;
  cor: string;
  codigoSponte: string;
  tokenSponte: string;
  criadoEm: string;
}

export type AppPage = 'dashboard' | 'unidades' | 'categorias' | 'planejamento';

export interface CategoriaDespesa {
  categoriaID: number;
  nome: string;
  grupo?: string;
  subgrupo?: string;
}

export interface ParcelaPagar {
  ContaPagarID: string;
  NumeroParcela: string;
  Sacado: string;
  SituacaoParcela: string;
  Vencimento: string;
  ValorParcela: number;
  Categoria: string;
  ContaID: string;
  TipoRecebimento: string;
  FormaCobranca: string;
  DataPagamento: string;
  ValorPago: number;
  RetornoOperacao: string;
}
