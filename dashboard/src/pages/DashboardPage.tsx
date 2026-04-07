import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList
} from 'recharts';
import {
  FileText, AlertCircle, DollarSign, Calendar, Filter, RefreshCw, TrendingUp, Hash, Wifi, WifiOff, Star
} from 'lucide-react';
import type { Unidade, ParcelaPagar } from '../types';
import { SyncAPI } from '../api/sync';
import { ContasPagarAPI } from '../api/contasPagar';
import { FavoritosAPI } from '../api/favoritos';

// ─────────────────────────────────────────────
// XML Parser (robust)
// ─────────────────────────────────────────────
const PARCELA_FIELDS = [
  'ContaPagarID', 'NumeroParcela', 'Sacado', 'SituacaoParcela',
  'Vencimento', 'Categoria', 'ContaID', 'TipoRecebimento',
  'FormaCobranca', 'DataPagamento', 'RetornoOperacao'
] as const;

const PARCELA_NUMERIC_FIELDS = ['ValorParcela', 'ValorPago'] as const;

const parseNumericPtBR = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const parseSponteXML = (xmlString: string): ParcelaPagar[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) { console.error('XML Parse Error:', parseError.textContent); return []; }

  const items = Array.from(xmlDoc.getElementsByTagName('wsParcelaPagar'));

  return items.map(item => {
    const getValue = (tag: string): string =>
      item.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

    const record: Record<string, string | number> = {};
    for (const field of PARCELA_FIELDS) record[field] = getValue(field);
    for (const field of PARCELA_NUMERIC_FIELDS) record[field] = parseNumericPtBR(getValue(field));

    return record as unknown as ParcelaPagar;
  });
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const situationClass = (sit: string): string => {
  const s = sit.toLowerCase();
  if (s.includes('pag')) return 'situation-paga';
  if (s.includes('cancel')) return 'situation-cancelada';
  if (s.includes('atras') || s.includes('vencid')) return 'situation-atrasada';
  if (s.includes('aberto') || s.includes('pendente')) return 'situation-pendente';
  return 'situation-default';
};

const MONTH_NAMES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f43f5e', '#84cc16', '#14b8a6', '#a855f7',
  '#d946ef', '#f97316'
];

// Gera lista de datas DD/MM/YYYY entre duas datas ISO
function getDatesInRange(startISO: string, endISO: string): string[] {
  const result: string[] = [];
  const cur = new Date(startISO);
  const end = new Date(endISO);
  while (cur <= end) {
    const dd = String(cur.getDate()).padStart(2, '0');
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const yyyy = cur.getFullYear();
    result.push(`${dd}/${mm}/${yyyy}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface Props {
  activeUnidade: Unidade | null;
  accentColor: string;
}

// ═════════════════════════════════════════════
// Dashboard Component
// ═════════════════════════════════════════════
export default function DashboardPage({ activeUnidade, accentColor }: Props) {
  const [data, setData] = useState<ParcelaPagar[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState<'api' | 'mock' | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const [startDate, setStartDate] = useState('2026-02-01');
  const [endDate, setEndDate] = useState('2026-02-28');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [apenasF, setApenasF] = useState(false);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const PAGE_SIZE = 20;

  // Carrega favoritos do banco
  useEffect(() => {
    FavoritosAPI.listar()
      .then(lista => setFavoritos(new Set(lista)))
      .catch(console.error);
  }, []);

  // ── Database Load ──
  const loadDataFromDB = useCallback(async () => {
    setLoading(true);
    setLoadingProgress('Carregando dados locais armazenados...');
    try {
      const dbData = await ContasPagarAPI.listar(activeUnidade?.id || null, startDate, endDate);
      setData(dbData);
      setDataSource('api');
      setLoading(false);
      setLoadingProgress('');
    } catch (err) {
      console.error('Erro local:', err);
      // Se der erro, mantemos o estado carregando falso
      setLoading(false);
    }
  }, [activeUnidade, startDate, endDate]);

  // ── Sync with Sponte/Supabase ──
  const syncSponteToDB = useCallback(async () => {
    const unitId = activeUnidade?.id;
    if (!unitId) return;

    setLoading(true);
    setError('');
    
    const codigoCliente = activeUnidade?.codigoSponte || '35695';
    const token = activeUnidade?.tokenSponte || 'fxW1Et2vS8Vf';

    try {
      // 1. Buscar e já Salvar PENDENTES
      const currentYear = new Date().getFullYear();
      setLoadingProgress('Buscando e salvando contas pendentes...');
      
      const pendentesRes = await axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelasPagar', {
        params: {
          nCodigoCliente: codigoCliente, sToken: token,
          sParametrosBusca: `Situacao=A Pagar&DataInicial=01/01/${currentYear - 1}&DataFinal=31/12/${currentYear + 1}`
        }, timeout: 30000
      });
      const pendentes = parseSponteXML(pendentesRes.data);
      if (pendentes.length > 0) {
        setLoadingProgress(`Salvando ${pendentes.length} contas pendentes no banco...`);
        await SyncAPI.syncContasPagar(unitId, pendentes);
        await loadDataFromDB(); // Atualiza a tela
      }

      // 2. Buscar PAGAS/QUITADAS por dia e já salvar
      // Garantir pelo menos os últimos 12 meses (para fechar o gráfico) 
      // ou o período selecionado, evitando "buracos" de dados.
      const today = new Date();
      const retro11 = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      
      // Criar datas locais de formatação para evitar bugs de fuso horário
      const buildLocalISO = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
      };

      const startD = new Date(startDate);
      startD.setHours(12, 0, 0, 0);
      const endD = new Date(endDate);
      endD.setHours(12, 0, 0, 0);

      const syncStart = startD < retro11 ? startD : retro11;
      const syncEnd = endD > today ? endD : today;

      const datas = getDatesInRange(buildLocalISO(syncStart), buildLocalISO(syncEnd));
      const BATCH = 5; // Lote maior para acelerar a busca de 1 ano

      for (let i = 0; i < datas.length; i += BATCH) {
        const batch = datas.slice(i, i + BATCH);
        setLoadingProgress(`Sincronizando dias ${Math.min(i + BATCH, datas.length)} de ${datas.length}: baixando e salvando...`);
        
        const batchResults = await Promise.all(
          batch.map(data =>
            axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelasPagar', {
              params: { nCodigoCliente: codigoCliente, sToken: token, sParametrosBusca: `DataPagamento=${data}` },
              timeout: 20000
            }).then(r => parseSponteXML(r.data).filter(p => p.SituacaoParcela && p.SituacaoParcela !== 'Pendente'))
            .catch(() => [] as ParcelaPagar[])
          )
        );
        
        const pagasNoLote = batchResults.flat();
        if (pagasNoLote.length > 0) {
           await SyncAPI.syncContasPagar(unitId, pagasNoLote);
           await loadDataFromDB(); // Atualiza a tela enquanto baixa
        }
      }

      setLastSync(new Date());
      await SyncAPI.logSync(unitId, 'sincronizacao_painel', 'sucesso', pendentes.length);
    } catch (err: any) {
      const msg = err?.response?.status ? `Erro HTTP ${err.response.status}` : err?.message || 'Erro desconhecido';
      console.error('Falha na Sincronização:', err);
      setError(`Erro ao sincronizar com Sponte: ${msg}`);
      await SyncAPI.logSync(unitId, 'sincronizacao_painel', 'erro', 0, msg);
    } finally {
      setLoading(false);
      setLoadingProgress('');
    }
  }, [activeUnidade, startDate, endDate, loadDataFromDB]);

  // Carrega do DB toda vez que o componente monta ou as datas/unidade mudam
  useEffect(() => { loadDataFromDB(); }, [loadDataFromDB]);
  
  // Reseta paginação se mudar filtro
  useEffect(() => { setTablePage(0); }, [startDate, endDate, selectedCategory, selectedSituations, apenasF]);

  // ── Derived Data ──
  const availableCategories = useMemo(() => {
    const cats = new Set(data.map(d => d.Categoria).filter(Boolean));
    return ['Todas', ...Array.from(cats).sort()];
  }, [data]);

  const availableSituations = useMemo(() => {
    const sits = new Set(data.map(d => d.SituacaoParcela || 'Sem Status'));
    return Array.from(sits).sort();
  }, [data]);

  // Converte DD/MM/YYYY para Date
  const parseDatePtBR = (s: string): Date | null => {
    if (!s) return null;
    const parts = s.split('/');
    if (parts.length === 3) return new Date(+parts[2], +parts[1] - 1, +parts[0]);
    return new Date(s);
  };

  const filteredData = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    let result = data.filter(item => {
      // Para pagas: filtrar por DataPagamento
      if (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.DataPagamento) {
        const d = parseDatePtBR(item.DataPagamento);
        return d ? d >= start && d <= end : false;
      }
      // Para pendentes: filtrar por Vencimento
      if (!item.Vencimento) return false;
      const vencDate = new Date(item.Vencimento);
      return vencDate >= start && vencDate <= end;
    });

    if (selectedCategory !== 'Todas') {
      result = result.filter(d => d.Categoria === selectedCategory);
    }
    if (apenasF && favoritos.size > 0) {
      result = result.filter(d => favoritos.has(d.Categoria));
    }
    if (selectedSituations.length > 0) {
      result = result.filter(d => selectedSituations.includes(d.SituacaoParcela || 'Sem Status'));
    }
    return result;
  }, [data, startDate, endDate, selectedCategory, apenasF, favoritos, selectedSituations]);

  const categoryDataArray = useMemo(() => {
    const agg = filteredData.reduce((acc, curr) => {
      const cat = curr.Categoria || 'Outros';
      // Para pagas: usar ValorPago; para pendentes: usar ValorParcela
      const val = (curr.SituacaoParcela && curr.SituacaoParcela !== 'Pendente' && curr.ValorPago > 0)
        ? curr.ValorPago
        : curr.ValorParcela;
      acc[cat] = (acc[cat] || 0) + val;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(agg)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData]);

  const monthlyDataArray = useMemo(() => {
    // Mostrar evolução dos últimos 12 meses baseado em DataPagamento (pagas) ou Vencimento (pendentes)
    const today = new Date();
    const twelveMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const endOfThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    const agg: Record<string, number> = {};
    for (const item of data) {
      if (selectedCategory !== 'Todas' && item.Categoria !== selectedCategory) continue;
      if (selectedSituations.length > 0 && !selectedSituations.includes(item.SituacaoParcela || 'Sem Status')) continue;
      let refDate: Date | null = null;
      if (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.DataPagamento) {
        refDate = parseDatePtBR(item.DataPagamento);
      } else if (item.Vencimento) {
        refDate = new Date(item.Vencimento);
      }
      if (!refDate || refDate < twelveMonthsAgo || refDate > endOfThisMonth) continue;
      const key = `${MONTH_NAMES[refDate.getMonth()]}/${refDate.getFullYear()}`;
      const val = (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.ValorPago > 0)
        ? item.ValorPago : item.ValorParcela;
      agg[key] = (agg[key] || 0) + val;
    }

    return Array.from({ length: 12 }).map((_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      const key = `${MONTH_NAMES[d.getMonth()]}/${d.getFullYear()}`;
      return { name: key, value: agg[key] || 0 };
    });
  }, [data, selectedCategory, selectedSituations]);

  const pagasNoP = useMemo(() => filteredData.filter(i => i.SituacaoParcela && i.SituacaoParcela !== 'Pendente'), [filteredData]);
  const pendentesNoP = useMemo(() => filteredData.filter(i => !i.SituacaoParcela || i.SituacaoParcela === 'Pendente'), [filteredData]);
  const totalPago = useMemo(() => pagasNoP.reduce((s, i) => s + (i.ValorPago || i.ValorParcela), 0), [pagasNoP]);
  const totalPendente = useMemo(() => pendentesNoP.reduce((s, i) => s + i.ValorParcela, 0), [pendentesNoP]);
  const uniqueCategories = useMemo(() => new Set(filteredData.map(d => d.Categoria)).size, [filteredData]);

  const pagedData = useMemo(() => {
    const start = tablePage * PAGE_SIZE;
    return filteredData.slice(start, start + PAGE_SIZE);
  }, [filteredData, tablePage]);
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

  // ── Render ──
  return (
    <div className="page-content">
      {/* Page Header */}
      <header className="header">
        <div className="header-info">
          <h1 style={{
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Dashboard · Contas a Pagar
            <span className="header-unit-tag" style={{ background: `${accentColor}22`, color: accentColor, marginLeft: '12px', fontSize:'0.9rem', padding: '4px 10px', borderRadius:'12px' }}>
              {activeUnidade ? activeUnidade.nome : 'Todas as Unidades'}
            </span>
          </h1>
          <p className="header-subtitle">
            {dataSource === 'api' ? (
              <span className="source-badge api"><Wifi size={14} /> Dados do Banco Local</span>
            ) : dataSource === 'mock' ? (
              <span className="source-badge mock"><WifiOff size={14} /> Dados de Demonstração</span>
            ) : null}
            {lastSync && (
              <span className="sync-time">Sincronizado às {lastSync.toLocaleTimeString('pt-BR')}</span>
            )}
          </p>
        </div>

        <div className="header-actions">
          <div className="filter-group" style={{ position: 'relative' }}>
            <Filter size={16} />
            <div 
              className="category-filter" 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '160px', justifyContent: 'space-between', padding: '0 8px' }}
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              <span>{selectedSituations.length === 0 ? 'Todas as Situações' : `${selectedSituations.length} selecionada(s)`}</span>
              <span style={{ fontSize: '10px' }}>▼</span>
            </div>
            {dropdownOpen && (
              <div className="dropdown-menu" style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px', background: '#1e293b', 
                border: '1px solid #334155', borderRadius: '8px', padding: '8px', zIndex: 50, 
                minWidth: '200px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '4px'
              }}>
                {availableSituations.map((sit: string) => {
                  const isChecked = selectedSituations.includes(sit);
                  return (
                    <label key={sit} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', color: '#e2e8f0', fontSize: '0.85rem' }}>
                      <input 
                        type="checkbox" 
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedSituations(prev => 
                            isChecked ? prev.filter(s => s !== sit) : [...prev, sit]
                          );
                        }}
                        style={{ accentColor: accentColor }}
                      />
                      {sit}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Filtro de Categorias (com favoritas) ── */}
          <div className="filter-group" style={{ position: 'relative' }}>
            {apenasF
              ? <Star size={15} fill="#f59e0b" style={{ color: '#f59e0b', flexShrink: 0 }} />
              : <Filter size={16} style={{ flexShrink: 0 }} />
            }
            <div
              className="category-filter"
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: '200px',
                justifyContent: 'space-between',
                padding: '0 8px',
                color: apenasF ? '#f59e0b' : 'inherit',
                fontWeight: apenasF ? 600 : 400,
              }}
              onClick={() => setCatDropdownOpen(o => !o)}
            >
              <span>
                {apenasF
                  ? `★ Favoritas (${favoritos.size})`
                  : selectedCategory === 'Todas'
                  ? 'Todas as Categorias'
                  : selectedCategory}
              </span>
              <span style={{ fontSize: '10px' }}>▼</span>
            </div>

            {catDropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                background: '#1e293b', border: '1px solid #334155', borderRadius: '10px',
                padding: '6px', zIndex: 50, minWidth: '240px',
                boxShadow: '0 20px 40px -8px rgba(0,0,0,0.7)',
                maxHeight: '340px', overflowY: 'auto',
              }}>
                {/* Opção: Todas */}
                <button
                  onClick={() => { setSelectedCategory('Todas'); setApenasF(false); setCatDropdownOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '7px 10px', borderRadius: '7px', border: 'none',
                    background: !apenasF && selectedCategory === 'Todas' ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: !apenasF && selectedCategory === 'Todas' ? '#6366f1' : '#e2e8f0',
                    fontWeight: !apenasF && selectedCategory === 'Todas' ? 600 : 400,
                    cursor: 'pointer', fontSize: '0.85rem', textAlign: 'left',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Todas as Categorias
                </button>

                {/* Opção: Apenas Favoritas */}
                {favoritos.size > 0 && (
                  <button
                    onClick={() => { setApenasF(true); setSelectedCategory('Todas'); setCatDropdownOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                      padding: '7px 10px', borderRadius: '7px', border: 'none',
                      background: apenasF ? 'rgba(245,158,11,0.15)' : 'transparent',
                      color: '#f59e0b',
                      fontWeight: apenasF ? 700 : 600,
                      cursor: 'pointer', fontSize: '0.85rem', textAlign: 'left',
                      fontFamily: 'Inter, sans-serif',
                      borderTop: '1px solid #334155',
                      marginTop: '4px', paddingTop: '8px',
                    }}
                  >
                    <Star size={14} fill={apenasF ? '#f59e0b' : 'none'} />
                    Apenas Favoritas ({favoritos.size})
                  </button>
                )}

                {/* Separador */}
                <div style={{ height: '1px', background: '#334155', margin: '6px 0' }} />

                {/* Lista de categorias */}
                {availableCategories.filter(c => c !== 'Todas').map(cat => {
                  const isFav = favoritos.has(cat);
                  const isActive = !apenasF && selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => { setSelectedCategory(cat); setApenasF(false); setCatDropdownOpen(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '7px', width: '100%',
                        padding: '6px 10px', borderRadius: '7px', border: 'none',
                        background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: isActive ? '#6366f1' : '#e2e8f0',
                        fontWeight: isActive ? 600 : 400,
                        cursor: 'pointer', fontSize: '0.83rem', textAlign: 'left',
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >
                      {isFav && <Star size={11} fill="#f59e0b" style={{ color: '#f59e0b', flexShrink: 0 }} />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="filter-group">
            <Calendar size={16} />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="date-input" />
            <span className="filter-separator">até</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="date-input" />
          </div>

          <button
            onClick={activeUnidade ? syncSponteToDB : () => alert('Para baixar novas contas da Sponte, selecione uma escola específica no menu à esquerda.')}
            className="refresh-btn"
            disabled={loading}
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Sincronizar
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <div className="spinner" style={{ borderTopColor: accentColor }} />
          <p>Conectando à API Sponte Educacional...</p>
          {loadingProgress && <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '8px' }}>{loadingProgress}</p>}
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon bg-blue"><FileText size={24} /></div>
              <div className="stat-details"><h3>Total no Período</h3><p>{filteredData.length} registros</p></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon bg-green"><DollarSign size={24} /></div>
              <div className="stat-details">
                <h3>Total Pago / Quitado</h3>
                <p>R$ {fmtBRL(totalPago)}</p>
                <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{pagasNoP.length} parcelas</small>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon bg-yellow"><TrendingUp size={24} /></div>
              <div className="stat-details">
                <h3>Total Pendente</h3>
                <p>R$ {fmtBRL(totalPendente)}</p>
                <small style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{pendentesNoP.length} parcelas</small>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon bg-purple"><Hash size={24} /></div>
              <div className="stat-details"><h3>Categorias</h3><p>{uniqueCategories}</p></div>
            </div>
          </div>

          {/* Charts */}
          <div className="charts-grid">
            <div className="chart-card" style={{ gridColumn: 'span 2' }}>
              <h2>
                Evolução Mensal · Últimos 12 Meses
                {selectedCategory !== 'Todas' && <span className="chart-filter-tag">{selectedCategory}</span>}
              </h2>
              <div className="chart-wrapper" style={{ height: '400px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyDataArray} margin={{ top: 25, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#cbd5e1" tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                    <Tooltip
                      formatter={(value: any) => [`R$ ${fmtBRL(Number(value))}`, 'Valor']}
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={55}>
                      {monthlyDataArray.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="top"
                        formatter={(v: any) => Number(v) > 0 ? `R$ ${fmtBRL(Number(v))}` : ''}
                        style={{ fill: '#e2e8f0', fontSize: '10px', fontWeight: 500 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-card" style={{ gridColumn: 'span 2' }}>
              <h2>Gastos por Categoria · Período Selecionado</h2>
              <div
                className="chart-wrapper"
                style={{ height: `${Math.max(400, categoryDataArray.length * 38)}px`, minHeight: '400px' }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryDataArray} layout="vertical" margin={{ top: 10, right: 140, left: 220, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke="#334155" />
                    <XAxis type="number" stroke="#94a3b8" tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                    <YAxis dataKey="name" type="category" stroke="#cbd5e1" width={210} tick={{ fontSize: 12 }} interval={0} />
                    <Tooltip
                      formatter={(value: any) => [`R$ ${fmtBRL(Number(value))}`, 'Valor']}
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#f8fafc' }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                      {categoryDataArray.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v: any) => `R$ ${fmtBRL(Number(v))}`}
                        style={{ fill: '#e2e8f0', fontSize: '11px', fontWeight: 500 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="table-card">
            <h2>
              Detalhamento · Período Selecionado
              <span className="table-count">{filteredData.length} registros</span>
            </h2>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fornecedor / Sacado</th>
                    <th>Categoria</th>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th>Data Pagamento</th>
                    <th>Situação</th>
                    <th className="text-right">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedData.map((item, idx) => {
                    const isPaga = item.SituacaoParcela && item.SituacaoParcela !== 'Pendente';
                    const valorExibir = isPaga && item.ValorPago > 0 ? item.ValorPago : item.ValorParcela;
                    return (
                    <tr key={`${item.ContaPagarID}-${idx}`} style={isPaga ? { background: 'rgba(16,185,129,0.04)' } : {}}>
                      <td className="cell-sacado">{item.Sacado}</td>
                      <td><span className="badge category-badge">{item.Categoria}</span></td>
                      <td>{item.NumeroParcela}</td>
                      <td>{item.Vencimento ? new Date(item.Vencimento).toLocaleDateString('pt-BR') : '—'}</td>
                      <td style={{ color: isPaga ? '#10b981' : '#64748b', fontSize: '0.85rem' }}>
                        {item.DataPagamento || '—'}
                      </td>
                      <td>
                        <span className={`badge ${situationClass(item.SituacaoParcela)}`}>
                          {item.SituacaoParcela || 'Sem Status'}
                        </span>
                      </td>
                      <td className="text-right font-medium cell-valor" style={{ color: isPaga ? '#10b981' : 'inherit' }}>
                        {fmtBRL(valorExibir)}
                      </td>
                    </tr>
                  )})}
                  {pagedData.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-row">Nenhum registro encontrado para os filtros aplicados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="table-pagination">
                <button disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)} className="page-btn">← Anterior</button>
                <span className="page-info">Página {tablePage + 1} de {totalPages}</span>
                <button disabled={tablePage >= totalPages - 1} onClick={() => setTablePage(p => p + 1)} className="page-btn">Próxima →</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
