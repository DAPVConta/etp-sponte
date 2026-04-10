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

export type AppPage = 'dashboard' | 'unidades' | 'plano_contas' | 'planejamento';

export interface ItemPlanoContas {
  sponteId: number;
  nome: string;
  tipo: 'grupo' | 'sub_grupo' | 'despesa';
  grupoNome: string | null;
  subGrupoNome: string | null;
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
