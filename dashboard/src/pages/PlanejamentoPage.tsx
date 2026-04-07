import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CalendarDays,
  TrendingUp,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Target,
  BarChart3,
  Plus,
  Minus,
  Check,
  Star,
  Search,
} from 'lucide-react';
import type { Unidade } from '../types';
import { PlanejamentoAPI, type ItemPlanejamento } from '../api/planejamento';
import { FavoritosAPI } from '../api/favoritos';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function getMesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMesesFuturos(qtd = 11): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i <= qtd; i++) {
    const date = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = `${MESES_PT[date.getMonth()]} ${date.getFullYear()}`;
    result.push({ value, label });
  }
  return result;
}

function fmt(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function parseMoeda(str: string): number {
  const cleaned = str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  unidades: Unidade[];
  accentColor: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlanejamentoPage({ unidades, accentColor }: Props) {
  // ── Filtros de unidades e meses
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([getMesAtual()]);
  const [showMesDropdown, setShowMesDropdown] = useState(false);
  const mesesDisponiveis = getMesesFuturos(11);

  // ── Favoritos e Busca
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [apenasF, setApenasF] = useState(false);
  const [searchCat, setSearchCat] = useState('');

  // ── Tabela de planejamento
  const [itens, setItens] = useState<ItemPlanejamento[]>([]);
  const [loadingMedias, setLoadingMedias] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [erroMsg, setErroMsg] = useState('');
  const [tabelaVisivel, setTabelaVisivel] = useState(false);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Carrega favoritos do banco ao montar
  useEffect(() => {
    FavoritosAPI.listar()
      .then(lista => setFavoritos(new Set(lista)))
      .catch(console.error);
  }, []);

  // ── Itens filtrados por favorito e busca
  const itensFiltrados = itens.filter(i => {
    if (apenasF && favoritos.size > 0 && !favoritos.has(i.categoria)) return false;
    if (searchCat && !i.categoria.toLowerCase().includes(searchCat.toLowerCase())) return false;
    return true;
  });

  // ── Toggle unidade
  const toggleUnidade = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setItens([]);
    setTabelaVisivel(false);
    setSaveStatus('idle');
  }, []);

  const toggleTodasUnidades = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === unidades.length) return new Set();
      return new Set(unidades.map(u => u.id));
    });
    setItens([]);
    setTabelaVisivel(false);
  }, [unidades]);

  // ── Toggle mês
  const toggleMes = useCallback((value: string) => {
    setMesesSelecionados(prev => {
      if (prev.includes(value)) {
        if (prev.length === 1) return prev;
        return prev.filter(m => m !== value);
      }
      return [...prev, value].sort();
    });
    setItens([]);
    setTabelaVisivel(false);
  }, []);

  // ── Carregar médias
  const carregarMedias = useCallback(async () => {
    if (!selectedIds.size) return;
    setLoadingMedias(true);
    setErroMsg('');
    setSaveStatus('idle');
    try {
      const mediasResults = await PlanejamentoAPI.calcularMedias([...selectedIds]);
      const mesPrincipal = mesesSelecionados[0];
      const salvos = await PlanejamentoAPI.buscar([...selectedIds], mesPrincipal);

      const mesclados: ItemPlanejamento[] = mediasResults.map(item => {
        const salvo = salvos.find(s => s.categoria === item.categoria);
        return {
          ...item,
          valorPlanejado: salvo ? salvo.valor_planejado : item.mediaSeisMeses,
          observacao: salvo?.observacao || '',
        };
      });

      setItens(mesclados);
      setTabelaVisivel(true);
    } catch (err: any) {
      setErroMsg(err.message || 'Erro ao carregar dados');
    } finally {
      setLoadingMedias(false);
    }
  }, [selectedIds, mesesSelecionados]);

  // ── Editar tabela
  const atualizarValor = useCallback((categoria: string, rawValue: string) => {
    setItens(prev =>
      prev.map(item =>
        item.categoria === categoria
          ? { ...item, valorPlanejado: parseMoeda(rawValue) }
          : item
      )
    );
  }, []);

  const atualizarObservacao = useCallback((categoria: string, obs: string) => {
    setItens(prev =>
      prev.map(item =>
        item.categoria === categoria ? { ...item, observacao: obs } : item
      )
    );
  }, []);

  // ── Salvar
  const salvar = useCallback(async () => {
    const itensParaSalvar = apenasF && favoritos.size > 0
      ? itens.filter(i => favoritos.has(i.categoria))
      : itens;
    if (!selectedIds.size || !mesesSelecionados.length || !itensParaSalvar.length) return;
    setSaving(true);
    setSaveStatus('idle');
    setErroMsg('');
    try {
      const promises: Promise<void>[] = [];
      for (const unidadeId of selectedIds) {
        for (const mes of mesesSelecionados) {
          promises.push(PlanejamentoAPI.salvar(unidadeId, mes, itensParaSalvar));
        }
      }
      await Promise.all(promises);
      setSaveStatus('ok');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setErroMsg(err.message || 'Erro ao salvar');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, [selectedIds, mesesSelecionados, itens, apenasF, favoritos]);

  // ── Totais (sobre itens filtrados)
  const totalMedia = itensFiltrados.reduce((s, i) => s + i.mediaSeisMeses, 0);
  const totalPlanejado = itensFiltrados.reduce((s, i) => s + i.valorPlanejado, 0);
  const variacaoTotal = totalPlanejado - totalMedia;

  // ── Flags
  const hasUnidades = unidades.length > 0;
  const hasSelection = selectedIds.size > 0;
  const canLoad = hasSelection && mesesSelecionados.length > 0;
  const temFavoritos = favoritos.size > 0;

  const mesesLabel =
    mesesSelecionados.length === 0
      ? 'Selecionar meses'
      : mesesSelecionados.length === 1
      ? mesesDisponiveis.find(m => m.value === mesesSelecionados[0])?.label || mesesSelecionados[0]
      : `${mesesSelecionados.length} meses selecionados`;

  return (
    <div className="page-content">
      {/* ── Cabeçalho ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ color: accentColor }}>
            <Target size={26} />
            Planejamento de Despesas
          </h1>
          <p className="page-description">
            Defina metas de gastos por categoria para as unidades selecionadas.
          </p>
        </div>
        {tabelaVisivel && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {saveStatus === 'ok' && (
              <span className="planner-save-status ok">
                <CheckCircle2 size={15} /> Salvo com sucesso!
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="planner-save-status error">
                <AlertCircle size={15} /> Erro ao salvar
              </span>
            )}
            <button
              className="btn-primary"
              style={{ background: accentColor }}
              onClick={salvar}
              disabled={saving || !itensFiltrados.length}
            >
              {saving ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
              {saving ? 'Salvando...' : 'Salvar Planejamento'}
            </button>
          </div>
        )}
      </div>

      {/* ── Erro global ── */}
      {erroMsg && (
        <div className="error-banner" style={{ marginBottom: '1.5rem' }}>
          <AlertCircle size={16} />
          <span>{erroMsg}</span>
        </div>
      )}

      {/* ── Painel de Filtros ── */}
      <div className="planner-filters-panel">

        {/* Filtro de unidades */}
        <div className="planner-filter-section">
          <p className="planner-filter-label">
            <Building2Icon size={14} />
            Unidades
            {hasSelection && (
              <span className="planner-badge" style={{ background: `${accentColor}22`, color: accentColor }}>
                {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          <div className="planner-unit-buttons">
            {/* Todas */}
            {(() => {
              const allSelected = selectedIds.size === unidades.length && unidades.length > 0;
              return (
                <button
                  className={`planner-unit-btn ${allSelected ? 'active' : ''}`}
                  style={allSelected
                    ? { borderColor: accentColor, background: accentColor, color: '#fff', boxShadow: `0 0 0 3px ${accentColor}33` }
                    : {}}
                  onClick={toggleTodasUnidades}
                >
                  {allSelected ? <Check size={14} strokeWidth={3} /> : <span className="planner-unit-dot" style={{ background: '#6366f1' }} />}
                  Todas
                </button>
              );
            })()}

            {unidades.map(u => {
              const sel = selectedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  className={`planner-unit-btn ${sel ? 'active' : ''}`}
                  style={sel
                    ? { borderColor: u.cor, background: u.cor, color: '#fff', boxShadow: `0 0 0 3px ${u.cor}44` }
                    : {}}
                  onClick={() => toggleUnidade(u.id)}
                >
                  {sel ? <Check size={14} strokeWidth={3} /> : <span className="planner-unit-dot" style={{ background: u.cor }} />}
                  {u.nome}
                </button>
              );
            })}

            {!hasUnidades && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Nenhuma unidade cadastrada.
              </p>
            )}
          </div>
        </div>

        <div className="planner-filter-divider" />

        {/* Filtro de meses */}
        <div className="planner-filter-section">
          <p className="planner-filter-label">
            <CalendarDays size={14} />
            Meses do Planejamento
            {mesesSelecionados.length > 0 && (
              <span className="planner-badge" style={{ background: `${accentColor}22`, color: accentColor }}>
                {mesesSelecionados.length} mês{mesesSelecionados.length !== 1 ? 'es' : ''}
              </span>
            )}
          </p>
          <div className="planner-mes-selector">
            <button
              className="planner-mes-trigger"
              onClick={() => setShowMesDropdown(d => !d)}
              style={showMesDropdown ? { borderColor: accentColor } : {}}
            >
              <CalendarDays size={15} style={{ color: accentColor }} />
              <span>{mesesLabel}</span>
              {showMesDropdown ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showMesDropdown && (
              <div className="planner-mes-dropdown">
                {mesesDisponiveis.map(m => {
                  const isSelected = mesesSelecionados.includes(m.value);
                  const isCurrent = m.value === getMesAtual();
                  return (
                    <button
                      key={m.value}
                      className={`planner-mes-option ${isSelected ? 'active' : ''}`}
                      style={isSelected ? { background: `${accentColor}18`, color: accentColor } : {}}
                      onClick={() => toggleMes(m.value)}
                    >
                      <span className="planner-mes-check">
                        {isSelected ? <CheckCircle2 size={14} /> : <span className="planner-mes-circle" />}
                      </span>
                      {m.label}
                      {isCurrent && <span className="planner-mes-current-tag">Atual</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="planner-filter-divider" />

        {/* Filtro de favoritos */}
        <div className="planner-filter-section">
          <p className="planner-filter-label">
            <Star size={14} style={{ color: '#f59e0b' }} />
            Categorias Favoritas
            {temFavoritos && (
              <span className="planner-badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                {favoritos.size} favorita{favoritos.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className={`planner-unit-btn ${!apenasF ? 'active' : ''}`}
              style={!apenasF
                ? { borderColor: accentColor, background: accentColor, color: '#fff', boxShadow: `0 0 0 3px ${accentColor}33` }
                : {}}
              onClick={() => setApenasF(false)}
            >
              {!apenasF && <Check size={14} strokeWidth={3} />}
              Todas as categorias
            </button>
            <button
              className={`planner-unit-btn ${apenasF ? 'active' : ''}`}
              style={apenasF
                ? { borderColor: '#f59e0b', background: '#f59e0b', color: '#0f172a', boxShadow: '0 0 0 3px rgba(245,158,11,0.3)' }
                : { borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b' }}
              onClick={() => setApenasF(true)}
              disabled={!temFavoritos}
            >
              {apenasF ? <Check size={14} strokeWidth={3} /> : <Star size={14} fill="none" />}
              Apenas favoritas
              {!temFavoritos && (
                <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(nenhuma)</span>
              )}
            </button>
            {!temFavoritos && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Acesse <strong>Categorias de Despesas</strong> para marcar favoritos ★
              </span>
            )}
          </div>
        </div>

        {/* Botão carregar */}
        <div className="planner-filter-action">
          <button
            className="btn-primary"
            style={{ background: accentColor, opacity: canLoad ? 1 : 0.5 }}
            onClick={carregarMedias}
            disabled={!canLoad || loadingMedias}
          >
            {loadingMedias
              ? <><RefreshCw size={15} className="spin" /> Carregando...</>
              : <><BarChart3 size={15} /> Carregar Categorias</>
            }
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {loadingMedias && (
        <div className="loading-state">
          <div className="spinner" style={{ borderTopColor: accentColor }} />
          <p style={{ color: 'var(--text-secondary)' }}>Calculando médias dos últimos 6 meses...</p>
        </div>
      )}

      {/* ── Conteúdo da tabela ── */}
      {tabelaVisivel && !loadingMedias && itens.length > 0 && (
        <>
          {/* Cards de resumo */}
          <div className="planner-summary-cards">
            <div className="planner-summary-card">
              <div className="planner-summary-icon" style={{ background: `${accentColor}22` }}>
                <TrendingUp size={20} style={{ color: accentColor }} />
              </div>
              <div>
                <p className="planner-summary-label">Média 6 Meses (Total)</p>
                <p className="planner-summary-value">{fmt(totalMedia)}</p>
              </div>
            </div>
            <div className="planner-summary-card">
              <div className="planner-summary-icon" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <Target size={20} style={{ color: 'var(--color-green)' }} />
              </div>
              <div>
                <p className="planner-summary-label">Total Planejado</p>
                <p className="planner-summary-value" style={{ color: 'var(--color-green)' }}>{fmt(totalPlanejado)}</p>
              </div>
            </div>
            <div className="planner-summary-card">
              <div
                className="planner-summary-icon"
                style={{ background: variacaoTotal >= 0 ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)' }}
              >
                {variacaoTotal >= 0
                  ? <Plus size={20} style={{ color: 'var(--color-red)' }} />
                  : <Minus size={20} style={{ color: 'var(--color-green)' }} />
                }
              </div>
              <div>
                <p className="planner-summary-label">Variação vs Média</p>
                <p
                  className="planner-summary-value"
                  style={{ color: variacaoTotal >= 0 ? 'var(--color-red)' : 'var(--color-green)' }}
                >
                  {variacaoTotal >= 0 ? '+' : ''}{fmt(variacaoTotal)}
                </p>
              </div>
            </div>
            <div className="planner-summary-card">
              <div className="planner-summary-icon" style={{ background: 'rgba(245,158,11,0.15)' }}>
                <CalendarDays size={20} style={{ color: 'var(--color-yellow)' }} />
              </div>
              <div>
                <p className="planner-summary-label">Meses × Unidades</p>
                <p className="planner-summary-value" style={{ color: 'var(--color-yellow)' }}>
                  {mesesSelecionados.length} × {selectedIds.size}
                </p>
              </div>
            </div>
          </div>

          {/* Tags de meses + badge de filtro ativo */}
          <div className="planner-meses-tags">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Planejando para:</span>
            {mesesSelecionados.map(m => (
              <span
                key={m}
                className="planner-mes-tag"
                style={{ background: `${accentColor}22`, color: accentColor, borderColor: `${accentColor}44` }}
              >
                {mesesDisponiveis.find(x => x.value === m)?.label || m}
              </span>
            ))}
            {apenasF && (
              <span className="planner-mes-tag" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }}>
                <Star size={11} fill="#f59e0b" /> apenas favoritas ({itensFiltrados.length})
              </span>
            )}
          </div>

          {/* Tabela */}
          <div className="table-card" style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '1rem' }}>
              <h2 style={{ margin: 0 }}>
                <BarChart3 size={18} style={{ color: accentColor }} />
                Categorias de Despesas
                <span className="table-count">{itensFiltrados.length} categorias</span>
              </h2>
              <div className="filter-group" style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', zIndex: 1 }} />
                <input
                  type="text"
                  placeholder="Pesquisar categoria..."
                  value={searchCat}
                  onChange={e => setSearchCat(e.target.value)}
                  className="date-input"
                  style={{ paddingLeft: '32px', minWidth: '240px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', height: '36px', fontSize: '0.85rem' }}
                />
              </div>
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '35%' }}>Categoria</th>
                    <th className="text-right">Média 6 meses</th>
                    <th className="text-right" style={{ minWidth: 180 }}>Valor Planejado</th>
                    <th className="text-right">Variação</th>
                    <th style={{ minWidth: 200 }}>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {itensFiltrados.map((item, idx) => {
                    const variacao = item.valorPlanejado - item.mediaSeisMeses;
                    const varPct = item.mediaSeisMeses > 0
                      ? ((variacao / item.mediaSeisMeses) * 100).toFixed(1)
                      : '0.0';
                    const isFav = favoritos.has(item.categoria);
                    return (
                      <tr key={item.categoria}>
                        <td>
                          <div className="planner-cat-name">
                            <span
                              className="planner-cat-rank"
                              style={{ background: `${accentColor}22`, color: accentColor }}
                            >
                              {idx + 1}
                            </span>
                            {item.categoria}
                            {isFav && (
                              <Star size={12} fill="#f59e0b" style={{ color: '#f59e0b', marginLeft: '4px', flexShrink: 0 }} />
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(item.mediaSeisMeses)}
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="planner-input-wrap">
                            <span className="planner-input-prefix">R$</span>
                            <MoedaInput 
                              valor={item.valorPlanejado}
                              inputRef={el => {
                                if (el) inputRefs.current.set(item.categoria, el);
                              }}
                              onChange={(novoValor) => atualizarValor(item.categoria, novoValor.toString())}
                              onEnter={() => {
                                const nextItem = itensFiltrados[idx + 1];
                                if (nextItem) inputRefs.current.get(nextItem.categoria)?.focus();
                              }}
                            />
                          </div>
                        </td>
                        <td className="text-right">
                          <span
                            className="planner-variacao"
                            style={{
                              color: variacao === 0
                                ? 'var(--text-secondary)'
                                : variacao > 0
                                ? 'var(--color-red)'
                                : 'var(--color-green)',
                            }}
                          >
                            {variacao > 0 ? '+' : ''}{fmt(variacao)}
                            <span className="planner-variacao-pct">
                              ({variacao >= 0 ? '+' : ''}{varPct}%)
                            </span>
                          </span>
                        </td>
                        <td>
                          <input
                            type="text"
                            className="planner-obs-input"
                            placeholder="Observação opcional..."
                            value={item.observacao || ''}
                            onChange={e => atualizarObservacao(item.categoria, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}

                  {itensFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-row">
                        Nenhuma categoria favorita disponível neste conjunto de dados.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="planner-tfoot">
                    <td><strong>TOTAL{apenasF ? ' (favoritas)' : ''}</strong></td>
                    <td className="text-right">
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(totalMedia)}</strong>
                    </td>
                    <td className="text-right">
                      <strong style={{ color: 'var(--color-green)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(totalPlanejado)}
                      </strong>
                    </td>
                    <td className="text-right">
                      <strong
                        style={{
                          color: variacaoTotal === 0
                            ? 'var(--text-secondary)'
                            : variacaoTotal > 0
                            ? 'var(--color-red)'
                            : 'var(--color-green)',
                        }}
                      >
                        {variacaoTotal >= 0 ? '+' : ''}{fmt(variacaoTotal)}
                      </strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Botão salvar (bottom) */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem', alignItems: 'center' }}>
            {saveStatus === 'ok' && (
              <span className="planner-save-status ok">
                <CheckCircle2 size={15} /> Planejamento salvo com sucesso!
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="planner-save-status error">
                <AlertCircle size={15} /> {erroMsg || 'Erro ao salvar'}
              </span>
            )}
            <button
              className="btn-primary"
              style={{ background: accentColor }}
              onClick={salvar}
              disabled={saving}
            >
              {saving ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
              {saving ? 'Salvando...' : `Salvar${apenasF ? ' Favoritas' : ''} (${mesesSelecionados.length} mês${mesesSelecionados.length !== 1 ? 'es' : ''})`}
            </button>
          </div>
        </>
      )}

      {tabelaVisivel && !loadingMedias && itens.length === 0 && (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <BarChart3 size={48} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
          <h3>Sem dados de despesas</h3>
          <p>Não foram encontradas despesas pagas nos últimos 6 meses para as unidades selecionadas.</p>
        </div>
      )}

      {!tabelaVisivel && !loadingMedias && (
        <div className="planner-empty-hint">
          <div className="planner-empty-hint-icon" style={{ background: `${accentColor}15` }}>
            <Target size={40} style={{ color: accentColor, opacity: 0.7 }} />
          </div>
          <h3>Selecione as unidades e os meses</h3>
          <p>Escolha uma ou mais unidades e os meses que deseja planejar,<br />depois clique em <strong>Carregar Categorias</strong>.</p>
        </div>
      )}
    </div>
  );
}

function Building2Icon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
  );
}

// ── Custom Input para Moeda ──
function MoedaInput({
  valor,
  onChange,
  onEnter,
  inputRef
}: {
  valor: number;
  onChange: (n: number) => void;
  onEnter: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const formatado = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
  const [str, setStr] = useState(formatado);

  // Sync prop -> state when external value changes
  useEffect(() => {
    const atualDb = parseMoeda(str);
    // tolerance for floating point matching
    if (Math.abs(atualDb - valor) > 0.001) {
      setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor));
    }
  }, [valor]); // eslint-disable-line

  const handleBlur = () => {
    const num = parseMoeda(str);
    onChange(num);
    setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const num = parseMoeda(str);
      onChange(num);
      setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num));
      onEnter();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Permite digitação livre (inclusive máscara automática se desejado futuramente)
    let val = e.target.value;
    setStr(val);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="planner-valor-input"
      value={str}
      onChange={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        // Opcional: seleciona tudo ao focar para facilitar re-digitar
        e.target.select();
      }}
    />
  );
}

