// ─────────────────────────────────────────────
// Shared application types
// ─────────────────────────────────────────────

// ── Auth ──────────────────────────────────────

export type UserRole = 'super_admin' | 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  empresaId: string | null;         // null apenas para super_admin
  empresaNomeFantasia: string | null;
  empresaRazaoSocial: string | null;
  empresaLogoUrl: string | null;
}

// ── Empresa (tenant raiz) ─────────────────────

export interface Empresa {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  email: string | null;
  logoUrl: string | null;
  ativo: boolean;
  criadoEm: string;
  // extras retornados por super_admin_listar_empresas
  totalUnidades?: number;
  totalUsuarios?: number;
}

// ── Unidade ───────────────────────────────────

export interface Unidade {
  id: string;
  empresaId: string;
  cnpj: string;
  nome: string;
  cor: string;
  codigoSponte: string;
  tokenSponte: string;
  isMatriz: boolean;
  criadoEm: string;
}

// ── Usuarios da empresa ───────────────────────

export interface UsuarioEmpresa {
  userId: string;
  email: string;
  role: Exclude<UserRole, 'super_admin'>;
  criadoEm: string;
}

// ── Outros tipos existentes ───────────────────

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

// Categorias de receitas (GetCategorias do Sponte — mesmo schema das despesas)
export interface CategoriaReceita {
  categoriaID: number;
  nome: string;
}

// Parcelas a receber (GetParcelas do Sponte — wsParcela)
export interface ParcelaReceber {
  ContaReceberID: string;
  NumeroParcela: string;
  Sacado: string;
  SituacaoParcela: string;
  SituacaoCNAB: string;
  Vencimento: string;
  ValorParcela: number;
  Categoria: string;
  ContaID: string;
  AlunoID: string;
  FaturaID: string;
  NumeroBoleto: string;
  TipoRecebimento: string;
  FormaCobranca: string;
  BolsaAssociada: string;
  DataPagamento: string;
  ValorPago: number;
  RetornoOperacao: string;
}
