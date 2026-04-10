import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BookOpen, RefreshCw, AlertCircle, Wifi, WifiOff, ChevronRight, ChevronDown, Database } from 'lucide-react';
import type { Unidade, ItemPlanoContas } from '../types';
import { SyncAPI } from '../api/sync';
import { supabase } from '../lib/supabase';

// ─────────────────────────────────────────────
// Estrutura de árvore para display
// ─────────────────────────────────────────────

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

// ─── Monta árvore a partir das linhas do banco ───
// Mantém a ordem definida pela coluna sort_order

interface DBRow {
  id: string;
  nome: string;
  tipo: string;
  grupo_nome: string | null;
  sub_grupo_nome: string | null;
  sort_order: number;
}

function buildTreeFromDB(rows: DBRow[]): TreeNode[] {
  // rows já chegam ordenadas por sort_order (via .order() na query)
  const grupos = rows.filter(r => r.tipo === 'grupo');
  const result: TreeNode[] = [];

  for (const g of grupos) {
    // sub_grupos deste grupo, na ordem correta
    const subGrupos = rows.filter(r => r.tipo === 'sub_grupo' && r.grupo_nome === g.nome);
    // despesas diretas (sem sub_grupo)
    const directDespesas = rows.filter(r => r.tipo === 'despesa' && r.grupo_nome === g.nome && !r.sub_grupo_nome);

    const subGrupoNodes: TreeNode[] = subGrupos.map(sg => {
      const sgDespesas = rows.filter(r => r.tipo === 'despesa' && r.sub_grupo_nome === sg.nome);
      return {
        id: sg.sort_order,
        nome: sg.nome,
        children: sgDespesas.map(d => ({ id: d.sort_order, nome: d.nome, children: [] })),
      };
    });

    // Intercala sub_grupos e despesas diretas usando sort_order
    const allChildren = [
      ...subGrupoNodes,
      ...directDespesas.map(d => ({ id: d.sort_order, nome: d.nome, children: [] })),
    ].sort((a, b) => a.id - b.id);

    result.push({ id: g.sort_order, nome: g.nome, children: allChildren });
  }

  // Ordena grupos pelo sort_order
  result.sort((a, b) => a.id - b.id);

  return result;
}

// ─────────────────────────────────────────────
// Helpers de parsing do XML da Sponte
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
  paiId: number;
  nome: string;
}

function parseByParentIds(raws: RawCategoria[]): ItemPlanoContas[] {
  const byId = new Map(raws.map(r => [r.id, r]));
  const childrenOf = new Map<number, number[]>();
  for (const r of raws) {
    const key = r.paiId <= 0 ? 0 : r.paiId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(r.id);
  }
  const result: ItemPlanoContas[] = [];

  // Se há um único nó raiz com nome misto (ex: "ETP - Escola Tecnica Particular"),
  // ele é apenas um container — pulamos ele e usamos seus filhos como grupos reais.
  let actualRootIds = childrenOf.get(0) || [];
  if (actualRootIds.length === 1) {
    const singleRoot = byId.get(actualRootIds[0]);
    if (singleRoot && !isAllCaps(singleRoot.nome)) {
      actualRootIds = childrenOf.get(actualRootIds[0]) || [];
    }
  }

  const processNode = (id: number, isRealRoot: boolean, grupoNome: string | null, subGrupoNome: string | null) => {
    const r = byId.get(id);
    if (!r) return;
    const children = childrenOf.get(id) || [];
    let tipo: 'grupo' | 'sub_grupo' | 'despesa';
    if (isRealRoot) tipo = 'grupo';
    else if (children.length > 0) tipo = 'sub_grupo';
    else tipo = 'despesa';
    result.push({
      sponteId: r.id,
      nome: r.nome,
      tipo,
      grupoNome: isRealRoot ? r.nome : grupoNome,
      subGrupoNome: tipo === 'sub_grupo' ? r.nome : subGrupoNome,
    });
    const nextGrupo = isRealRoot ? r.nome : grupoNome;
    const nextSubGrupo = tipo === 'sub_grupo' ? r.nome : subGrupoNome;
    for (const childId of children) processNode(childId, false, nextGrupo, nextSubGrupo);
  };

  for (const rootId of actualRootIds) processNode(rootId, true, null, null);
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
        currentGrupo = r.nome; currentSubGrupo = null; grupoHadItems = false;
        result.push({ sponteId: r.id, nome: r.nome, tipo: 'grupo', grupoNome: r.nome, subGrupoNome: null });
      } else {
        currentSubGrupo = r.nome;
        result.push({ sponteId: r.id, nome: r.nome, tipo: 'sub_grupo', grupoNome: currentGrupo, subGrupoNome: r.nome });
      }
    } else {
      if (!currentSubGrupo) grupoHadItems = true;
      result.push({ sponteId: r.id, nome: r.nome, tipo: 'despesa', grupoNome: currentGrupo, subGrupoNome: currentSubGrupo });
    }
  }
  return result;
}

function parsePlanoContasXML(xmlString: string): ItemPlanoContas[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) return [];
  const nodes = Array.from(xmlDoc.getElementsByTagName('Categorias'));
  if (nodes.length === 0) return [];
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
  return hasPaiId ? parseByParentIds(raws) : parseByOrdering(raws);
}

// ─────────────────────────────────────────────
// Tipos internos do componente
// ─────────────────────────────────────────────

interface UnidadeResult {
  unidade: Unidade;
  tree: TreeNode[];
  totalDespesas: number;
  loading: boolean;
  error: string;
  source: 'db' | 'api' | 'none';
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
  const [syncing, setSyncing] = useState(false);
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

  // ── Carrega do banco de dados ──
  const loadFromDB = useCallback(async () => {
    if (unidades.length === 0) return;

    setResults(unidades.map(u => ({ unidade: u, tree: [], totalDespesas: 0, loading: true, error: '', source: 'none' })));

    const promises = unidades.map(async (u): Promise<UnidadeResult> => {
      try {
        const { data, error } = await supabase
          .from('etp_plano_contas')
          .select('id, nome, tipo, grupo_nome, sub_grupo_nome, sort_order')
          .eq('unidade_id', u.id)
          .order('sort_order', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
          return { unidade: u, tree: [], totalDespesas: 0, loading: false, error: '', source: 'none' };
        }

        const tree = buildTreeFromDB(data);
        const totalDespesas = data.filter(r => r.tipo === 'despesa').length;

        return { unidade: u, tree, totalDespesas, loading: false, error: '', source: 'db' };
      } catch (e: any) {
        return { unidade: u, tree: [], totalDespesas: 0, loading: false, error: e?.message || 'Erro desconhecido', source: 'none' };
      }
    });

    const all = await Promise.all(promises);
    setResults(all);

    // Expande apenas o primeiro nível (grupos raiz)
    const keys = new Set<string>();
    for (const r of all) {
      for (const node of r.tree) {
        keys.add(`${r.unidade.id}:${node.id}`);
      }
    }
    setExpanded(keys);
  }, [unidades]);

  // ── Sincroniza com a API Sponte e recarrega do banco ──
  const syncFromAPI = useCallback(async () => {
    if (unidades.length === 0 || syncing) return;
    setSyncing(true);

    const promises = unidades.map(async (u) => {
      try {
        const res = await axios.get('/api-sponte/WSAPIEdu.asmx/GetCategoriasDespesas', {
          params: { nCodigoCliente: u.codigoSponte, sToken: u.tokenSponte },
          timeout: 20000,
        });
        const itens = parsePlanoContasXML(res.data);
        await SyncAPI.syncPlanoContas(u.id, itens);
        await SyncAPI.logSync(u.id, 'plano_contas', 'sucesso', itens.length);
      } catch (e: any) {
        console.error(`Erro ao sincronizar ${u.nome}:`, e);
        try { await SyncAPI.logSync(u.id, 'plano_contas', 'erro', 0, String(e)); } catch {}
      }
    });

    await Promise.all(promises);
    setLastSync(new Date());
    setSyncing(false);

    // Recarrega do banco após sync
    await loadFromDB();
  }, [unidades, syncing, loadFromDB]);

  // Carrega do banco ao montar
  useEffect(() => { loadFromDB(); }, [loadFromDB]);

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

    const isRoot = depth === 0;
    const hasSubGroups = node.children.some(c => c.children.length > 0);
    const subGroupCount = node.children.filter(c => c.children.length > 0).length;

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
          {hasSubGroups && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: '0.4rem',
              background: isRoot ? `${cor}33` : '#334155',
              color: isRoot ? cor : '#94a3b8',
              borderRadius: '4px',
              padding: '0 0.35rem',
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.02em',
              lineHeight: '1.4rem',
              flexShrink: 0,
            }}>
              +{subGroupCount} sub
            </span>
          )}
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
    if (r.tree.length === 0) return null;

    return (
      <div key={r.unidade.id} className="table-card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <span style={{ background: r.unidade.cor, width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: r.unidade.cor }}>{r.unidade.nome}</span>
          <span className="table-count">
            {r.totalDespesas} despesas · {r.tree.length} grupo{r.tree.length !== 1 ? 's' : ''}
          </span>
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {r.tree.map(node => renderNode(node, 0, r.unidade.id, r.unidade.cor))}
        </div>
      </div>
    );
  };

  const isLoading = results.some(r => r.loading);
  const totalItens = results.reduce((s, r) => s + r.tree.length, 0);

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
            onClick={loadFromDB}
            className="refresh-btn"
            disabled={isLoading || syncing}
            style={{ background: '#334155', boxShadow: 'none', marginRight: '0.5rem' }}
          >
            <Database size={16} />
            Recarregar
          </button>
          <button
            onClick={syncFromAPI}
            className="refresh-btn"
            disabled={isLoading || syncing}
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={16} className={syncing ? 'spin' : ''} />
            Sincronizar API
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
              ) : r.source === 'none' ? (
                <Database size={24} style={{ color: '#64748b' }} />
              ) : (
                <Wifi size={24} style={{ color: r.unidade.cor }} />
              )}
            </div>
            <div className="stat-details">
              <h3 style={{ color: r.unidade.cor }}>{r.unidade.nome}</h3>
              {r.loading ? (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Carregando...</p>
              ) : r.error ? (
                <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>Erro ao carregar</p>
              ) : r.source === 'none' ? (
                <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Sem dados — clique em Sincronizar</p>
              ) : (
                <p>
                  {r.tree.length} grupo{r.tree.length !== 1 ? 's' : ''} ·{' '}
                  {r.totalDespesas} despesas
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
          <p>Carregando plano de contas...</p>
        </div>
      )}

      {syncing && (
        <div className="loading-state">
          <div className="spinner" style={{ borderTopColor: accentColor }} />
          <p>Sincronizando com a API Sponte...</p>
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
      {!isLoading && !syncing && totalItens > 0 && results.map(renderUnidade)}

      {/* Estado vazio */}
      {!isLoading && !syncing && totalItens === 0 && results.length > 0 && !results.some(r => r.error) && (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <BookOpen size={48} style={{ color: '#64748b', opacity: 0.4 }} />
          <h3>Nenhum item no plano de contas</h3>
          <p>Clique em <strong>Sincronizar API</strong> para buscar o plano de contas via Sponte e salvar no banco.</p>
        </div>
      )}
    </div>
  );
}
