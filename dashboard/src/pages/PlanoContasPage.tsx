import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BookOpen, RefreshCw, AlertCircle, Wifi, WifiOff, ChevronRight, ChevronDown } from 'lucide-react';
import type { Unidade, ItemPlanoContas } from '../types';
import { SyncAPI } from '../api/sync';

// ─────────────────────────────────────────────
// Helpers de parsing
// ─────────────────────────────────────────────

function cleanName(raw: string): string {
  return raw.replace(/\s*\(\*\)\s*$/, '').trim();
}

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

interface RawCategoria {
  id: number;
  paiId: number; // -1 = campo não presente no XML
  nome: string;
}

// ─── Estrutura de árvore para display ───

interface TreeNode {
  id: number;
  nome: string;
  children: TreeNode[];
}

/** Conta recursivamente quantas folhas (sem filhos) existem na subárvore */
function countLeaves(node: TreeNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

/** Monta árvore completa para exibição usando paiId */
function buildDisplayTreeByIds(raws: RawCategoria[]): TreeNode[] {
  const nodeMap = new Map<number, TreeNode>(
    raws.map(r => [r.id, { id: r.id, nome: r.nome, children: [] }])
  );
  const roots: TreeNode[] = [];

  for (const r of raws) {
    const node = nodeMap.get(r.id)!;
    if (r.paiId <= 0) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(r.paiId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node); // órfão → trata como raiz
      }
    }
  }

  return roots;
}

/** Monta árvore para exibição usando maiúsculas + ordem (fallback) */
function buildDisplayTreeByOrdering(raws: RawCategoria[]): TreeNode[] {
  const roots: TreeNode[] = [];
  let currentGrupo: TreeNode | null = null;
  let currentSubGrupo: TreeNode | null = null;
  let grupoHadItems = false;

  for (const r of raws) {
    if (isAllCaps(r.nome)) {
      if (currentGrupo === null || grupoHadItems) {
        currentGrupo = { id: r.id, nome: r.nome, children: [] };
        roots.push(currentGrupo);
        currentSubGrupo = null;
        grupoHadItems = false;
      } else {
        currentSubGrupo = { id: r.id, nome: r.nome, children: [] };
        currentGrupo.children.push(currentSubGrupo);
      }
    } else {
      const leaf: TreeNode = { id: r.id, nome: r.nome, children: [] };
      if (currentSubGrupo) {
        currentSubGrupo.children.push(leaf);
      } else if (currentGrupo) {
        currentGrupo.children.push(leaf);
        grupoHadItems = true;
      } else {
        roots.push(leaf);
      }
    }
  }

  return roots;
}

// ─── Parsing para DB (ItemPlanoContas) — mantido igual ───

function parseByParentIds(raws: RawCategoria[]): ItemPlanoContas[] {
  const byId = new Map(raws.map(r => [r.id, r]));
  const childrenOf = new Map<number, number[]>();

  for (const r of raws) {
    const key = r.paiId <= 0 ? 0 : r.paiId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(r.id);
  }

  const result: ItemPlanoContas[] = [];

  const processNode = (id: number, grupoNome: string | null, subGrupoNome: string | null) => {
    const r = byId.get(id);
    if (!r) return;
    const children = childrenOf.get(id) || [];
    const isRoot = r.paiId <= 0;

    let tipo: 'grupo' | 'sub_grupo' | 'despesa';
    if (isRoot) {
      tipo = 'grupo';
    } else if (children.length > 0) {
      tipo = 'sub_grupo';
    } else {
      tipo = 'despesa';
    }

    result.push({
      sponteId: r.id,
      nome: r.nome,
      tipo,
      grupoNome: isRoot ? r.nome : grupoNome,
      subGrupoNome: tipo === 'sub_grupo' ? r.nome : subGrupoNome,
    });

    const nextGrupo = isRoot ? r.nome : grupoNome;
    const nextSubGrupo = tipo === 'sub_grupo' ? r.nome : subGrupoNome;
    for (const childId of children) {
      processNode(childId, nextGrupo, nextSubGrupo);
    }
  };

  for (const rootId of childrenOf.get(0) || []) {
    processNode(rootId, null, null);
  }

  return result;
}

function parseByOrdering(raws: RawCategoria[]): ItemPlanoContas[] {
  const result: ItemPlanoContas[] = [];
  let currentGrupo: string | null = null;
  let currentSubGrupo: string | null = null;
  let grupoHadItems = false;

  for (const r of raws) {
    if (isAllCaps(r.nome)) {
      if (currentGrupo === null || grupoHadItems) {
        currentGrupo = r.nome;
        currentSubGrupo = null;
        grupoHadItems = false;
        result.push({ sponteId: r.id, nome: r.nome, tipo: 'grupo', grupoNome: r.nome, subGrupoNome: null });
      } else {
        currentSubGrupo = r.nome;
        result.push({ sponteId: r.id, nome: r.nome, tipo: 'sub_grupo', grupoNome: currentGrupo, subGrupoNome: r.nome });
      }
    } else {
      if (!currentSubGrupo) grupoHadItems = true;
      result.push({
        sponteId: r.id,
        nome: r.nome,
        tipo: 'despesa',
        grupoNome: currentGrupo,
        subGrupoNome: currentSubGrupo,
      });
    }
  }

  return result;
}

/** Extrai dados brutos do XML e retorna tanto a lista plana (para DB) quanto a árvore (para display) */
function parsePlanoContasXML(xmlString: string): { itens: ItemPlanoContas[]; tree: TreeNode[] } {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) return { itens: [], tree: [] };

  const nodes = Array.from(xmlDoc.getElementsByTagName('Categorias'));
  if (nodes.length === 0) return { itens: [], tree: [] };

  const raws: RawCategoria[] = [];
  let hasPaiId = false;

  for (const node of nodes) {
    const id = parseInt(node.getElementsByTagName('CategoriaID')[0]?.textContent?.trim() || '0', 10);
    const paiIdEl = node.getElementsByTagName('CategoriaPaiID')[0];
    const paiId = paiIdEl ? parseInt(paiIdEl.textContent?.trim() || '0', 10) : -1;
    if (paiIdEl) hasPaiId = true;
    const nome = cleanName(node.getElementsByTagName('Nome')[0]?.textContent?.trim() || '');
    if (id > 0 && nome) raws.push({ id, paiId, nome });
  }

  if (raws.length === 0) return { itens: [], tree: [] };

  const itens = hasPaiId ? parseByParentIds(raws) : parseByOrdering(raws);
  const tree = hasPaiId ? buildDisplayTreeByIds(raws) : buildDisplayTreeByOrdering(raws);

  return { itens, tree };
}

// ─────────────────────────────────────────────
// Tipos internos do componente
// ─────────────────────────────────────────────

interface UnidadeResult {
  unidade: Unidade;
  itens: ItemPlanoContas[]; // para sync/stats
  tree: TreeNode[];         // para display
  loading: boolean;
  error: string;
  synced: boolean;
}

interface Props {
  unidades: Unidade[];
  accentColor: string;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PlanoContasPage({ unidades, accentColor }: Props) {
  const [results, setResults] = useState<UnidadeResult[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  // key = `${unidadeId}:${nodeId}` para controlar expansão de qualquer nível
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fetchAll = useCallback(async () => {
    if (unidades.length === 0) return;

    setResults(
      unidades.map(u => ({ unidade: u, itens: [], tree: [], loading: true, error: '', synced: false }))
    );

    const promises = unidades.map(async (u): Promise<UnidadeResult> => {
      try {
        const res = await axios.get('/api-sponte/WSAPIEdu.asmx/GetCategoriasDespesas', {
          params: { nCodigoCliente: u.codigoSponte, sToken: u.tokenSponte },
          timeout: 20000,
        });
        const { itens, tree } = parsePlanoContasXML(res.data);

        try {
          await SyncAPI.syncPlanoContas(u.id, itens);
          await SyncAPI.logSync(u.id, 'plano_contas', 'sucesso', itens.length);
        } catch (syncErr) {
          console.error(`Falha ao sincronizar plano de contas da unidade ${u.nome}:`, syncErr);
          await SyncAPI.logSync(u.id, 'plano_contas', 'erro', itens.length, String(syncErr));
        }

        return { unidade: u, itens, tree, loading: false, error: '', synced: true };
      } catch (e: any) {
        return { unidade: u, itens: [], tree: [], loading: false, error: e?.message || 'Erro desconhecido', synced: false };
      }
    });

    const all = await Promise.all(promises);
    setResults(all);
    setLastSync(new Date());

    // Expande automaticamente apenas o primeiro nível (raiz)
    const keys = new Set<string>();
    for (const r of all) {
      for (const node of r.tree) {
        keys.add(`${r.unidade.id}:${node.id}`);
      }
    }
    setExpanded(keys);
  }, [unidades]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Render recursivo de um nó da árvore ──
  const renderNode = (node: TreeNode, depth: number, unidadeId: string, cor: string): JSX.Element => {
    const key = `${unidadeId}:${node.id}`;
    const isOpen = expanded.has(key);
    const isLeaf = node.children.length === 0;
    const totalLeaves = isLeaf ? 0 : node.children.reduce((s, c) => s + countLeaves(c), 0);

    if (isLeaf) {
      return (
        <div
          key={key}
          style={{
            padding: '0.28rem 0.75rem',
            paddingLeft: `${0.75 + depth * 0.5}rem`,
            fontSize: '0.79rem',
            color: '#94a3b8',
            borderLeft: '2px solid #334155',
            marginBottom: '0.08rem',
          }}
        >
          {node.nome}
        </div>
      );
    }

    // Estilo varia por profundidade
    const isRoot = depth === 0;
    const buttonStyle: React.CSSProperties = isRoot
      ? {
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          width: '100%', textAlign: 'left',
          background: `${cor}18`, border: `1px solid ${cor}33`,
          borderRadius: '6px', padding: '0.5rem 0.75rem',
          cursor: 'pointer', color: cor,
          fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.04em',
          marginBottom: '0.15rem',
        }
      : {
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          width: '100%', textAlign: 'left',
          background: depth === 1 ? '#1e293b' : '#172032',
          border: `1px solid ${depth === 1 ? '#334155' : '#263347'}`,
          borderRadius: '6px',
          padding: `${depth === 1 ? '0.4' : '0.32'}rem 0.75rem`,
          cursor: 'pointer',
          color: depth === 1 ? '#cbd5e1' : '#94a3b8',
          fontWeight: depth === 1 ? 600 : 500,
          fontSize: depth === 1 ? '0.82rem' : '0.79rem',
          marginBottom: '0.12rem',
        };

    const iconSize = isRoot ? 14 : 13;

    return (
      <div key={key}>
        <button onClick={() => toggleExpanded(key)} style={buttonStyle}>
          {isOpen ? <ChevronDown size={iconSize} /> : <ChevronRight size={iconSize} />}
          {node.nome}
          <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.73rem', opacity: 0.7 }}>
            {totalLeaves} despesa{totalLeaves !== 1 ? 's' : ''}
          </span>
        </button>

        {isOpen && (
          <div style={{ paddingLeft: '1rem', marginBottom: isRoot ? '0.25rem' : '0.1rem' }}>
            {node.children.map(child => renderNode(child, depth + 1, unidadeId, cor))}
          </div>
        )}
      </div>
    );
  };

  // ── Render de uma unidade ──
  const renderUnidade = (r: UnidadeResult) => {
    if (r.loading || r.error) return null;

    const totalDespesas = r.itens.filter(i => i.tipo === 'despesa').length;
    const totalGrupos = r.tree.length;

    return (
      <div key={r.unidade.id} className="table-card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <span
            className="unit-dot"
            style={{ background: r.unidade.cor, width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }}
          />
          <span style={{ color: r.unidade.cor }}>{r.unidade.nome}</span>
          <span className="table-count">
            {totalDespesas} despesas · {totalGrupos} grupo{totalGrupos !== 1 ? 's' : ''}
          </span>
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {r.tree.map(node => renderNode(node, 0, r.unidade.id, r.unidade.cor))}
        </div>
      </div>
    );
  };

  const isLoading = results.some(r => r.loading);
  const totalItens = results.reduce((s, r) => s + r.itens.length, 0);

  return (
    <div className="page-content">
      {/* Header */}
      <header className="header">
        <div className="header-info">
          <h1 style={{
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Plano de Contas
          </h1>
          <p className="header-subtitle">
            Estrutura hierárquica: Grupo → Sub-Grupo → Despesa
            {lastSync && (
              <span className="sync-time" style={{ marginLeft: '0.75rem' }}>
                Sincronizado às {lastSync.toLocaleTimeString('pt-BR')}
              </span>
            )}
          </p>
        </div>

        <div className="header-actions">
          <button
            onClick={fetchAll}
            className="refresh-btn"
            disabled={isLoading}
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
            Sincronizar
          </button>
        </div>
      </header>

      {/* Cards de status por unidade */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        {results.map(r => (
          <div key={r.unidade.id} className="stat-card">
            <div className="stat-icon" style={{ background: `${r.unidade.cor}22` }}>
              {r.loading ? (
                <RefreshCw size={24} className="spin" style={{ color: r.unidade.cor }} />
              ) : r.error ? (
                <WifiOff size={24} style={{ color: '#ef4444' }} />
              ) : (
                <Wifi size={24} style={{ color: r.unidade.cor }} />
              )}
            </div>
            <div className="stat-details">
              <h3 style={{ color: r.unidade.cor }}>{r.unidade.nome}</h3>
              {r.loading ? (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Carregando...</p>
              ) : r.error ? (
                <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>Erro na API</p>
              ) : (
                <p>
                  {r.tree.length} grupo{r.tree.length !== 1 ? 's' : ''} ·{' '}
                  {r.itens.filter(i => i.tipo === 'despesa').length} despesas
                </p>
              )}
            </div>
          </div>
        ))}

        {results.length === 0 && (
          <div className="stat-card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#64748b' }}>
            Nenhuma unidade cadastrada.
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="loading-state">
          <div className="spinner" style={{ borderTopColor: accentColor }} />
          <p>Sincronizando plano de contas...</p>
        </div>
      )}

      {/* Erros */}
      {results.filter(r => r.error).map(r => (
        <div key={r.unidade.id} className="error-banner" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={16} />
          <span><strong>{r.unidade.nome}:</strong> {r.error}</span>
        </div>
      ))}

      {/* Árvores por unidade */}
      {!isLoading && totalItens > 0 && results.map(renderUnidade)}

      {/* Estado vazio */}
      {!isLoading && totalItens === 0 && results.length > 0 && !results.some(r => r.error) && (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <BookOpen size={48} style={{ color: '#64748b', opacity: 0.4 }} />
          <h3>Nenhum item no plano de contas</h3>
          <p>Clique em <strong>Sincronizar</strong> para buscar o plano de contas via API Sponte.</p>
        </div>
      )}
    </div>
  );
}
