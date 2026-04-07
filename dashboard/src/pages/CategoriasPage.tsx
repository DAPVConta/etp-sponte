import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Tag, RefreshCw, AlertCircle, Wifi, WifiOff, Hash, Search, Star } from 'lucide-react';
import type { Unidade, CategoriaDespesa } from '../types';
import { SyncAPI } from '../api/sync';
import { FavoritosAPI } from '../api/favoritos';

// ─────────────────────────────────────────────
// XML Parser
// ─────────────────────────────────────────────
const parseCategoriasDespesasXML = (xmlString: string): CategoriaDespesa[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) return [];

  const categoriaNodes = Array.from(xmlDoc.getElementsByTagName('Categorias'));
  const result: CategoriaDespesa[] = [];

  for (const node of categoriaNodes) {
    const idEl = node.getElementsByTagName('CategoriaID')[0];
    const nomeEl = node.getElementsByTagName('Nome')[0];
    if (idEl && nomeEl) {
      const id = parseInt(idEl.textContent?.trim() || '0', 10);
      const nome = nomeEl.textContent?.trim() || '';
      if (id > 0 && nome) result.push({ categoriaID: id, nome });
    }
  }
  return result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
};

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface Props {
  unidades: Unidade[];
  accentColor: string;
}

interface UnidadeResult {
  unidade: Unidade;
  categorias: CategoriaDespesa[];
  loading: boolean;
  error: string;
  source: 'api' | 'error' | null;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function CategoriasPage({ unidades, accentColor }: Props) {
  const [results, setResults] = useState<UnidadeResult[]>([]);
  const [search, setSearch] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // ── Favoritos ──
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [loadingFav, setLoadingFav] = useState<Set<string>>(new Set());
  const [mostraApenasF, setMostraApenasF] = useState(false);
  const [erroFav, setErroFav] = useState('');

  // Carrega favoritos do banco
  useEffect(() => {
    FavoritosAPI.listar()
      .then(lista => {
        console.log('[Favoritos] Carregados:', lista);
        setFavoritos(new Set(lista));
      })
      .catch(err => {
        console.error('[Favoritos] Erro ao carregar:', err);
        setErroFav(`Tabela de favoritos não encontrada. Execute o SQL: CREATE TABLE etp_categorias_favoritas... Erro: ${err.message}`);
      });
  }, []);

  const toggleFavorito = useCallback(async (categoria: string) => {
    setErroFav('');
    // Otimista: atualiza estado local imediatamente
    const eraFav = favoritos.has(categoria);
    setFavoritos(prev => {
      const next = new Set(prev);
      if (eraFav) next.delete(categoria);
      else next.add(categoria);
      return next;
    });
    setLoadingFav(prev => { const s = new Set(prev); s.add(categoria); return s; });
    try {
      const isFav = await FavoritosAPI.toggle(categoria);
      console.log('[Favoritos] Toggle', categoria, '->', isFav ? 'favorito' : 'removido');
      // Confirma com o valor real do banco
      setFavoritos(prev => {
        const next = new Set(prev);
        if (isFav) next.add(categoria);
        else next.delete(categoria);
        return next;
      });
    } catch (err: any) {
      console.error('[Favoritos] Erro ao toggle:', err);
      // Reverte estado local em caso de erro
      setFavoritos(prev => {
        const next = new Set(prev);
        if (eraFav) next.add(categoria); // reverte para favoritado
        else next.delete(categoria);     // reverte para não favoritado
        return next;
      });
      setErroFav(
        err?.message?.includes('does not exist')
          ? 'Tabela não existe. Execute no Supabase: CREATE TABLE etp_categorias_favoritas (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), categoria TEXT NOT NULL UNIQUE, criado_em TIMESTAMPTZ DEFAULT now()); ALTER TABLE etp_categorias_favoritas ENABLE ROW LEVEL SECURITY; CREATE POLICY "allow_all" ON etp_categorias_favoritas FOR ALL USING (true) WITH CHECK (true);'
          : `Erro ao salvar favorito: ${err.message}`
      );
    } finally {
      setLoadingFav(prev => { const s = new Set(prev); s.delete(categoria); return s; });
    }
  }, [favoritos]);

  const fetchAll = useCallback(async () => {
    if (unidades.length === 0) return;

    setResults(
      unidades.map(u => ({ unidade: u, categorias: [], loading: true, error: '', source: null }))
    );

    const promises = unidades.map(async (u): Promise<UnidadeResult> => {
      try {
        const res = await axios.get('/api-sponte/WSAPIEdu.asmx/GetCategoriasDespesas', {
          params: { nCodigoCliente: u.codigoSponte, sToken: u.tokenSponte },
          timeout: 20000,
        });
        const categorias = parseCategoriasDespesasXML(res.data);

        try {
          await SyncAPI.syncCategorias(u.id, categorias);
          await SyncAPI.logSync(u.id, 'categorias', 'sucesso', categorias.length);
        } catch (syncErr) {
          console.error(`Falha ao sincronizar categorias da unidade ${u.nome}:`, syncErr);
          await SyncAPI.logSync(u.id, 'categorias', 'erro', categorias.length, String(syncErr));
        }

        return { unidade: u, categorias, loading: false, error: '', source: 'api' };
      } catch (e: any) {
        return {
          unidade: u,
          categorias: [],
          loading: false,
          error: e?.message || 'Erro desconhecido',
          source: 'error',
        };
      }
    });

    const all = await Promise.all(promises);
    setResults(all);
    setLastSync(new Date());
  }, [unidades]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Derived ──
  const allCategories = results.flatMap(r => r.categorias.map(c => c.nome));
  const uniqueCategories = [...new Set(allCategories)].sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );

  const filteredCategories = uniqueCategories.filter(c => {
    const matchSearch = c.toLowerCase().includes(search.toLowerCase());
    const matchFav = !mostraApenasF || favoritos.has(c);
    return matchSearch && matchFav;
  });

  const totalByCategory = filteredCategories.map(cat => ({ nome: cat }));

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
            Categorias de Despesas
          </h1>
          <p className="header-subtitle">
            {lastSync && (
              <span className="sync-time">Sincronizado às {lastSync.toLocaleTimeString('pt-BR')}</span>
            )}
            {favoritos.size > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.78rem', color: '#f59e0b', marginLeft: '0.75rem',
              }}>
                <Star size={12} fill="#f59e0b" />
                {favoritos.size} favorita{favoritos.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>

        <div className="header-actions">
          {/* Toggle favoritos */}
          <button
            className={`cat-fav-toggle-btn ${mostraApenasF ? 'active' : ''}`}
            onClick={() => setMostraApenasF(v => !v)}
            title={mostraApenasF ? 'Mostrando apenas favoritas' : 'Mostrar apenas favoritas'}
          >
            <Star size={15} fill={mostraApenasF ? '#f59e0b' : 'none'} style={{ color: '#f59e0b' }} />
            {mostraApenasF ? 'Apenas favoritas' : 'Favoritas'}
          </button>

          <div className="filter-group" style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', zIndex: 1 }} />
            <input
              type="text"
              placeholder="Filtrar categorias..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="date-input"
              style={{ paddingLeft: '32px', minWidth: '220px' }}
            />
          </div>
          <button
            onClick={fetchAll}
            className="refresh-btn"
            disabled={results.some(r => r.loading)}
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={16} className={results.some(r => r.loading) ? 'spin' : ''} />
            Sincronizar
          </button>
        </div>
      </header>

      {/* Banner de erro de favoritos */}
      {erroFav && (
        <div className="error-banner" style={{ marginBottom: '1rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} />
            <strong>Erro nos favoritos:</strong>
          </div>
          <span style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{erroFav}</span>
          <button
            onClick={() => setErroFav('')}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline', padding: 0 }}
          >
            Fechar
          </button>
        </div>
      )}

      {/* Status por unidade */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        {results.map(r => (
          <div key={r.unidade.id} className="stat-card">
            <div className="stat-icon" style={{ background: `${r.unidade.cor}22` }}>
              {r.loading ? (
                <RefreshCw size={24} className="spin" style={{ color: r.unidade.cor }} />
              ) : r.source === 'error' ? (
                <WifiOff size={24} style={{ color: '#ef4444' }} />
              ) : (
                <Wifi size={24} style={{ color: r.unidade.cor }} />
              )}
            </div>
            <div className="stat-details">
              <h3 style={{ color: r.unidade.cor }}>{r.unidade.nome}</h3>
              {r.loading ? (
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Carregando...</p>
              ) : r.source === 'error' ? (
                <p style={{ fontSize: '0.8rem', color: '#ef4444' }}>Erro na API</p>
              ) : (
                <p>{r.categorias.length} categorias</p>
              )}
            </div>
          </div>
        ))}

        {results.length === 0 && (
          <div className="stat-card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#64748b' }}>
            Nenhuma unidade cadastrada. Acesse "Cadastro de Unidades" para adicionar.
          </div>
        )}
      </div>

      {/* Tabela comparativa por categoria */}
      {results.length > 0 && (
        <div className="table-card">
          <h2>
            Categorias de Despesas por Unidade
            <span className="table-count">
              {filteredCategories.length} categorias {search && `(filtradas de ${uniqueCategories.length})`}
            </span>
          </h2>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  {/* Coluna de favorito */}
                  <th style={{ width: '44px', textAlign: 'center' }}>
                    <Star size={13} style={{ color: '#f59e0b' }} />
                  </th>
                  <th style={{ minWidth: '200px' }}>
                    <Hash size={13} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                    Categoria de Despesa
                  </th>
                  {results.map(r => (
                    <th key={r.unidade.id} style={{ textAlign: 'center', minWidth: '120px' }}>
                      <span style={{ color: r.unidade.cor }}>
                        <span
                          className="unit-dot"
                          style={{ background: r.unidade.cor, display: 'inline-block', marginRight: '6px' }}
                        />
                        {r.unidade.nome}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totalByCategory.map(({ nome }) => {
                  const isFav = favoritos.has(nome);
                  const isLoadingFav = loadingFav.has(nome);
                  return (
                    <tr key={nome} className={isFav ? 'cat-row-favorita' : ''}>
                      {/* Botão favoritar */}
                      <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                        <button
                          className={`cat-fav-btn ${isFav ? 'active' : ''}`}
                          onClick={() => toggleFavorito(nome)}
                          disabled={isLoadingFav}
                          title={isFav ? 'Remover favorito' : 'Adicionar favorito'}
                        >
                          {isLoadingFav
                            ? <RefreshCw size={14} className="spin" />
                            : <Star
                                size={15}
                                fill={isFav ? '#f59e0b' : 'none'}
                                strokeWidth={isFav ? 0 : 1.5}
                              />
                          }
                        </button>
                      </td>
                      <td className="cell-sacado">
                        <Tag size={13} style={{ marginRight: '6px', verticalAlign: 'middle', color: '#64748b' }} />
                        {nome}
                        {isFav && (
                          <span className="cat-fav-badge">★ favorita</span>
                        )}
                      </td>
                      {results.map(r => {
                        const has = r.categorias.some(c => c.nome === nome);
                        const catItem = r.categorias.find(c => c.nome === nome);
                        return (
                          <td key={r.unidade.id} style={{ textAlign: 'center' }}>
                            {r.loading ? (
                              <span style={{ color: '#64748b', fontSize: '0.75rem' }}>...</span>
                            ) : r.source === 'error' ? (
                              <span style={{ color: '#475569', fontSize: '0.75rem' }}>—</span>
                            ) : has ? (
                              <span
                                className="badge"
                                style={{
                                  background: `${r.unidade.cor}22`,
                                  color: r.unidade.cor,
                                  border: `1px solid ${r.unidade.cor}44`,
                                  fontSize: '0.7rem',
                                  padding: '2px 8px',
                                }}
                              >
                                ✓ ID {catItem?.categoriaID}
                              </span>
                            ) : (
                              <span style={{ color: '#334155', fontSize: '0.75rem' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {totalByCategory.length === 0 && !results.some(r => r.loading) && (
                  <tr>
                    <td colSpan={results.length + 2} className="empty-row">
                      {mostraApenasF
                        ? 'Nenhuma categoria favorita encontrada. Clique na ⭐ para favoritar.'
                        : search
                        ? `Nenhuma categoria encontrada para "${search}".`
                        : 'Nenhuma categoria de despesas carregada.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Alertas de erro por unidade */}
          {results.filter(r => r.source === 'error').map(r => (
            <div key={r.unidade.id} className="error-banner" style={{ marginTop: '1rem' }}>
              <AlertCircle size={16} />
              <span>
                <strong>{r.unidade.nome}:</strong> {r.error}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
