import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import {
  AlertCircle, DollarSign, CalendarDays, Filter, RefreshCw, TrendingUp, Hash,
  Wifi, ChevronDown, Clock, AlertTriangle,
} from 'lucide-react';
import { HelpHint } from '@/components/HelpHint';
import type { Unidade, ParcelaReceber } from '../types';
import { ContasReceberAPI } from '../api/contasReceber';
import { PlanoContasAPI } from '../api/planoContas';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k`
    : v.toFixed(0);

const MONTH_NAMES    = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_PT_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6',
  '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#d946ef', '#ef4444',
];

function getMesAtualKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getMesesAno() {
  const ano = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => ({
    value: `${ano}-${String(i + 1).padStart(2, '0')}`,
    label: `${MESES_PT_FULL[i]} ${ano}`,
  }));
}
function mesesParaRange(meses: string[]): { startDate: string; endDate: string } {
  const sorted = [...meses].sort();
  const [anoI, mesI] = sorted[0].split('-').map(Number);
  const [anoF, mesF] = sorted[sorted.length - 1].split('-').map(Number);
  const start = `${anoI}-${String(mesI).padStart(2, '0')}-01`;
  const lastDay = new Date(anoF, mesF, 0).getDate();
  const end   = `${anoF}-${String(mesF).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate: start, endDate: end };
}

// ── Classificadores ────────────────────────────────────────────────────────
// Receita: situação determina se é realmente recebida (só com DataPagamento)
const isRecebida = (p: ParcelaReceber): boolean =>
  !!p.DataPagamento && !!p.SituacaoParcela && p.SituacaoParcela !== 'A Receber';

const isVencida = (p: ParcelaReceber): boolean => {
  if (isRecebida(p)) return false;
  if (!p.Vencimento) return false;
  const venc = new Date(p.Vencimento);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return venc < hoje && p.SituacaoParcela !== 'Cancelada';
};

const isCancelada = (p: ParcelaReceber): boolean =>
  (p.SituacaoParcela || '').toLowerCase().includes('cancel');

const situacaoVariant = (sit: string): 'success' | 'error' | 'warning' | 'info' => {
  const s = (sit || '').toLowerCase();
  if (s.includes('receb') || s.includes('pag') || s.includes('quit')) return 'success';
  if (s.includes('cancel'))                                            return 'error';
  if (s.includes('vencid') || s.includes('atras'))                     return 'error';
  if (s.includes('receber') || s.includes('pendente') || s.includes('aberto')) return 'warning';
  return 'info';
};

const parseDatePtBR = (s: string): Date | null => {
  if (!s) return null;
  const p = s.split('/');
  if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
  return new Date(s);
};

const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// ── Props ────────────────────────────────────────────────────────────────────
interface Props { activeUnidade: Unidade | null; unidades: Unidade[]; accentColor: string; }

// ── Componente ───────────────────────────────────────────────────────────────
export default function DashboardReceitasPage({ activeUnidade, unidades, accentColor }: Props) {
  const [data, setData]             = useState<ParcelaReceber[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [rankingMode, setRankingMode] = useState<'categoria' | 'grupo'>('categoria');
  const [receitasPorGrupo, setReceitasPorGrupo] = useState<Record<string, Set<string>>>({});

  const mesesDisponiveis = getMesesAno();
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([getMesAtualKey()]);
  const [showMesDropdown, setShowMesDropdown]     = useState(false);
  const mesBtnRef = useRef<HTMLButtonElement>(null);

  const { startDate, endDate } = useMemo(
    () => mesesSelecionados.length > 0 ? mesesParaRange(mesesSelecionados) : mesesParaRange([getMesAtualKey()]),
    [mesesSelecionados]
  );

  const [selectedCategory, setSelectedCategory]   = useState('Todas');
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen]           = useState(false);
  const [catDropdownOpen, setCatDropdownOpen]     = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const mesDropdownRef = useRef<HTMLDivElement>(null);

  const [tablePage, setTablePage] = useState(0);
  const PAGE_SIZE = 20;

  // ── Fecha dropdowns ao clicar fora ───────────────────────────────────────
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (filtersRef.current && !filtersRef.current.contains(t)
          && (!mesDropdownRef.current || !mesDropdownRef.current.contains(t))) {
        setDropdownOpen(false);
        setCatDropdownOpen(false);
        setShowMesDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ── Carrega dados do banco ───────────────────────────────────────────────
  const loadDataFromDB = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const dbData = await ContasReceberAPI.listar(activeUnidade?.id || null, startDate, endDate);
      setData(dbData);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(`Erro ao carregar dados: ${e?.message || 'desconhecido'}`);
    } finally {
      setLoading(false);
    }
  }, [activeUnidade, startDate, endDate]);

  useEffect(() => { loadDataFromDB(); }, [loadDataFromDB]);

  useEffect(() => { setTablePage(0); }, [mesesSelecionados, selectedCategory, selectedSituations]);

  // ── Carregar plano de contas para agrupamento por grupo ──────────────────
  useEffect(() => {
    const ids = activeUnidade ? [activeUnidade.id] : unidades.map(u => u.id);
    if (!ids.length) return;
    Promise.all(ids.map(id => PlanoContasAPI.listarPorUnidade(id).catch(() => [])))
      .then(results => {
        const map: Record<string, Set<string>> = {};
        for (const items of results) {
          for (const item of items) {
            if (item.tipo === 'receita' && item.grupoNome) {
              if (!map[item.grupoNome]) map[item.grupoNome] = new Set();
              map[item.grupoNome].add(item.nome);
            }
          }
        }
        setReceitasPorGrupo(map);
      })
      .catch(console.error);
  }, [activeUnidade, unidades]);

  // ── Categorias e situações disponíveis ───────────────────────────────────
  const availableCategories = useMemo(() => {
    const cats = new Set(data.map(d => d.Categoria).filter(Boolean));
    return ['Todas', ...Array.from(cats).sort((a, b) => a.localeCompare(b, 'pt-BR'))];
  }, [data]);

  const availableSituations = useMemo(() => {
    const sits = new Set(data.map(d => d.SituacaoParcela || 'Sem Status'));
    return Array.from(sits).sort();
  }, [data]);

  // ── Filtragem por período/categoria/situação ─────────────────────────────
  const filteredData = useMemo(() => {
    const mesesSet = new Set(mesesSelecionados);
    const getMes = (p: ParcelaReceber): string | null => {
      if (isRecebida(p) && p.DataPagamento) {
        const d = parseDatePtBR(p.DataPagamento);
        if (d) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (p.Vencimento) {
        const d = new Date(p.Vencimento);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      return null;
    };
    let result = data.filter(p => {
      const mes = getMes(p);
      return mes ? mesesSet.has(mes) : false;
    });
    if (selectedCategory !== 'Todas') result = result.filter(p => p.Categoria === selectedCategory);
    if (selectedSituations.length > 0) {
      result = result.filter(p => selectedSituations.includes(p.SituacaoParcela || 'Sem Status'));
    }
    return result;
  }, [data, mesesSelecionados, selectedCategory, selectedSituations]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let recebido = 0, aReceber = 0, vencido = 0, qtd = filteredData.length;
    let qtdRecebidas = 0, qtdAReceber = 0, qtdVencidas = 0;
    for (const p of filteredData) {
      if (isCancelada(p)) continue;
      if (isRecebida(p)) {
        recebido += p.ValorPago > 0 ? p.ValorPago : p.ValorParcela;
        qtdRecebidas++;
      } else if (isVencida(p)) {
        vencido += p.ValorParcela;
        qtdVencidas++;
      } else {
        aReceber += p.ValorParcela;
        qtdAReceber++;
      }
    }
    return { recebido, aReceber, vencido, qtd, qtdRecebidas, qtdAReceber, qtdVencidas };
  }, [filteredData]);

  // ── Evolução mensal (12 meses do ano atual) ──────────────────────────────
  const monthlyDataArray = useMemo(() => {
    const ano = new Date().getFullYear();
    const aggRec: Record<string, number> = {};
    const aggAR:  Record<string, number> = {};
    for (const p of data) {
      if (selectedCategory !== 'Todas' && p.Categoria !== selectedCategory) continue;
      if (isCancelada(p)) continue;
      // Recebidas → usa DataPagamento
      if (isRecebida(p) && p.DataPagamento) {
        const d = parseDatePtBR(p.DataPagamento);
        if (!d || d.getFullYear() !== ano) continue;
        const k = `${ano}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const v = p.ValorPago > 0 ? p.ValorPago : p.ValorParcela;
        aggRec[k] = (aggRec[k] || 0) + v;
      } else if (p.Vencimento) {
        // A receber / vencidas → usa Vencimento
        const d = new Date(p.Vencimento);
        if (d.getFullYear() !== ano) continue;
        const k = `${ano}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        aggAR[k] = (aggAR[k] || 0) + p.ValorParcela;
      }
    }
    return Array.from({ length: 12 }, (_, i) => {
      const k = `${ano}-${String(i + 1).padStart(2, '0')}`;
      return {
        name:     `${MONTH_NAMES[i]}/${ano}`,
        recebido: aggRec[k] || 0,
        aReceber: aggAR[k]  || 0,
      };
    });
  }, [data, selectedCategory]);

  // ── Ranking por categoria / grupo ────────────────────────────────────────
  // Mapa reverso: nome (normalizado) da receita → grupo
  const catToGrupo = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [grupo, receitas] of Object.entries(receitasPorGrupo)) {
      for (const r of receitas) m[norm(r)] = grupo;
    }
    return m;
  }, [receitasPorGrupo]);

  const hasGruposReceita = Object.keys(receitasPorGrupo).length > 0;

  const categoryDataArray = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const p of filteredData) {
      if (isCancelada(p)) continue;
      const cat = p.Categoria || 'Sem Categoria';
      const val = isRecebida(p) && p.ValorPago > 0 ? p.ValorPago : p.ValorParcela;
      const label = rankingMode === 'grupo'
        ? (catToGrupo[norm(cat)] || 'Sem Grupo')
        : cat;
      agg[label] = (agg[label] || 0) + val;
    }
    return Object.entries(agg)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData, rankingMode, catToGrupo]);

  // ── Paginação da tabela ──────────────────────────────────────────────────
  const pagedData  = useMemo(
    () => filteredData.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE),
    [filteredData, tablePage]
  );
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

  const tooltipStyle = {
    backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px',
    color: '#1e293b', boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto px-6 py-4 animate-fade-in">
      {/* Header */}
      <header ref={filtersRef} className="flex justify-between items-center mb-3 pb-3 border-b border-border/50 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1
              className="text-[1.2rem] font-extrabold tracking-tight flex items-center gap-2 flex-wrap"
              style={{
                backgroundImage: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}
            >
              Dashboard · Contas a Receber
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[0.65rem] font-semibold">
              <Wifi size={11} /> Banco Local
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative z-[15]">
          {/* Filtro de situação */}
          <div className="relative flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground backdrop-blur transition-all">
            <Filter size={13} />
            <button
              className="flex items-center gap-1.5 text-xs cursor-pointer min-w-[130px] justify-between"
              onClick={() => setDropdownOpen(o => !o)}
            >
              <span>{selectedSituations.length === 0 ? 'Todas as Situações' : `${selectedSituations.length} selecionada(s)`}</span>
              <ChevronDown size={11} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-xl p-1.5 z-[60] min-w-[220px] max-h-[360px] overflow-y-auto shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
                {availableSituations.map(sit => (
                  <label key={sit} className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg cursor-pointer text-sm text-foreground hover:bg-black/5 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedSituations.includes(sit)}
                      style={{ accentColor }}
                      onChange={() => setSelectedSituations(prev =>
                        prev.includes(sit) ? prev.filter(s => s !== sit) : [...prev, sit]
                      )}
                    />
                    {sit}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Filtro de categoria */}
          <div className="relative flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg backdrop-blur transition-all">
            <Filter size={13} className="text-muted-foreground flex-shrink-0" />
            <button
              className="flex items-center gap-1.5 text-xs cursor-pointer min-w-[160px] justify-between text-muted-foreground"
              onClick={() => setCatDropdownOpen(o => !o)}
            >
              <span>{selectedCategory === 'Todas' ? 'Todas as Categorias' : selectedCategory}</span>
              <ChevronDown size={13} />
            </button>
            {catDropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-xl p-1.5 z-[60] min-w-[260px] max-h-[360px] overflow-y-auto shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
                <button
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                    selectedCategory === 'Todas' ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-black/5'
                  )}
                  onClick={() => { setSelectedCategory('Todas'); setCatDropdownOpen(false); }}
                >
                  Todas as Categorias
                </button>
                <div className="h-px bg-border my-1.5" />
                {availableCategories.filter(c => c !== 'Todas').map(cat => (
                  <button
                    key={cat}
                    className={cn(
                      'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors truncate',
                      selectedCategory === cat ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-black/5'
                    )}
                    onClick={() => { setSelectedCategory(cat); setCatDropdownOpen(false); }}
                  >
                    <span className="truncate">{cat}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Seletor de meses */}
          <div className="relative">
            <button
              ref={mesBtnRef}
              className={cn(
                'flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg text-xs transition-all min-w-[150px] justify-between backdrop-blur',
                showMesDropdown ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/40'
              )}
              onClick={() => setShowMesDropdown(d => !d)}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays size={13} style={{ color: accentColor }} />
                <span className={cn('text-xs', mesesSelecionados.length > 0 && 'text-foreground font-medium')}>
                  {mesesSelecionados.length === 0 ? 'Selecionar mês'
                    : mesesSelecionados.length === 1
                      ? (mesesDisponiveis.find(m => m.value === mesesSelecionados[0])?.label || mesesSelecionados[0])
                      : `${mesesSelecionados.length} meses`}
                </span>
              </div>
              <ChevronDown size={11} className={cn('text-muted-foreground transition-transform', showMesDropdown && 'rotate-180')} />
            </button>
            {showMesDropdown && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setShowMesDropdown(false)} />
                <div
                  ref={mesDropdownRef}
                  className="fixed z-[9999] bg-white border border-border rounded-xl p-1.5 shadow-2xl"
                  style={{
                    top:  (mesBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    left: mesBtnRef.current?.getBoundingClientRect().left ?? 0,
                    minWidth: Math.max(mesBtnRef.current?.getBoundingClientRect().width ?? 0, 210),
                  }}
                >
                  {mesesDisponiveis.map(m => {
                    const isSel = mesesSelecionados.includes(m.value);
                    return (
                      <button
                        key={m.value}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-all',
                          isSel ? 'font-semibold' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                        )}
                        style={isSel ? { background: `${accentColor}18`, color: accentColor } : {}}
                        onClick={() => setMesesSelecionados(prev =>
                          prev.includes(m.value)
                            ? (prev.length === 1 ? prev : prev.filter(x => x !== m.value))
                            : [...prev, m.value].sort()
                        )}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body
            )}
          </div>

          <Button
            onClick={loadDataFromDB}
            disabled={loading}
            className="gap-2"
            size="sm"
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm mb-4">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-4 gap-3 mb-4 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
        {/* Recebido */}
        <Card className="relative overflow-hidden p-4">
          <div className="absolute top-0 left-0 h-1 w-full bg-emerald-500" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide">Recebido</p>
              <p className="text-xl font-bold mt-1 text-emerald-700">R$ {fmtBRL(kpis.recebido)}</p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">{kpis.qtdRecebidas} parcela(s)</p>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-100">
              <DollarSign size={18} className="text-emerald-600" />
            </div>
          </div>
        </Card>

        {/* A Receber */}
        <Card className="relative overflow-hidden p-4">
          <div className="absolute top-0 left-0 h-1 w-full bg-amber-500" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide">A Receber</p>
              <p className="text-xl font-bold mt-1 text-amber-700">R$ {fmtBRL(kpis.aReceber)}</p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">{kpis.qtdAReceber} parcela(s)</p>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-100">
              <Clock size={18} className="text-amber-600" />
            </div>
          </div>
        </Card>

        {/* Vencido */}
        <Card className="relative overflow-hidden p-4">
          <div className="absolute top-0 left-0 h-1 w-full bg-red-500" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide">Vencidos</p>
              <p className="text-xl font-bold mt-1 text-red-700">R$ {fmtBRL(kpis.vencido)}</p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">{kpis.qtdVencidas} parcela(s)</p>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-red-100">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
          </div>
        </Card>

        {/* Total parcelas */}
        <Card className="relative overflow-hidden p-4">
          <div className="absolute top-0 left-0 h-1 w-full" style={{ background: accentColor }} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide">Total no Período</p>
              <p className="text-xl font-bold mt-1" style={{ color: accentColor }}>{kpis.qtd}</p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">parcela(s) no filtro</p>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${accentColor}18` }}>
              <Hash size={18} style={{ color: accentColor }} />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Evolução mensal ── */}
      <Card className="p-4 mb-4 animate-fade-in-up">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <TrendingUp size={14} style={{ color: accentColor }} /> Evolução mensal — {new Date().getFullYear()}
              <HelpHint text="Comparativo mês a mês do ano corrente. Barras verdes (Recebido) somam parcelas efetivamente pagas no mês — usa DataPagamento e ValorPago (ou ValorParcela se não houver). Barras âmbar (A Receber) somam parcelas em aberto pelo mês de vencimento. Respeita os filtros de situação, categoria e unidade aplicados acima." />
            </h2>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              <span className="text-emerald-600 font-medium">Recebido</span> usa DataPagamento · <span className="text-amber-600 font-medium">A receber</span> usa Vencimento
            </p>
          </div>
        </div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={monthlyDataArray} margin={{ top: 15, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `R$ ${fmtCompact(v)}`} />
              <Tooltip
                formatter={(value, name) => [`R$ ${fmtBRL(Number(value))}`, name === 'recebido' ? 'Recebido' : 'A receber']}
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="recebido" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32}>
                <LabelList dataKey="recebido" position="top" formatter={(v: number) => v > 0 ? fmtCompact(v) : ''} style={{ fill: '#10b981', fontSize: '10px', fontWeight: 600 }} />
              </Bar>
              <Bar dataKey="aReceber" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32}>
                <LabelList dataKey="aReceber" position="top" formatter={(v: number) => v > 0 ? fmtCompact(v) : ''} style={{ fill: '#d97706', fontSize: '10px', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-5 mt-2 text-[0.7rem] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Recebido
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-500" /> A Receber
          </span>
        </div>
      </Card>

      {/* ── Ranking por categoria / grupo ── */}
      {categoryDataArray.length > 0 && (
        <Card className="p-4 mb-4 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              Receitas por {rankingMode === 'grupo' ? 'Grupo' : 'Categoria'} · Período Selecionado
              <HelpHint text="Ranking horizontal das receitas agrupadas por categoria (ou grupo contábil, quando disponível). Soma apenas parcelas que casam com os filtros ativos e com o período selecionado. Quando há grupos cadastrados no plano de contas, o toggle Categoria/Grupo permite alternar a granularidade da agregação." />
            </h2>
            {hasGruposReceita && (
              <div className="inline-flex rounded-lg border border-border bg-card/75 p-0.5 text-xs">
                <button
                  onClick={() => setRankingMode('categoria')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-all font-medium',
                    rankingMode === 'categoria' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                  style={rankingMode === 'categoria' ? { background: `${accentColor}18`, color: accentColor } : {}}
                >
                  Categoria
                </button>
                <button
                  onClick={() => setRankingMode('grupo')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-all font-medium',
                    rankingMode === 'grupo' ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                  style={rankingMode === 'grupo' ? { background: `${accentColor}18`, color: accentColor } : {}}
                >
                  Grupo
                </button>
              </div>
            )}
          </div>
          <div style={{ height: Math.max(280, categoryDataArray.length * 32) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDataArray} layout="vertical" margin={{ top: 10, right: 140, left: 220, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  stroke="#94a3b8"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#94a3b8"
                  tick={{ fill: '#475569', fontSize: 12 }}
                  width={210}
                  interval={0}
                />
                <Tooltip
                  formatter={(value) => [`R$ ${fmtBRL(Number(value))}`, 'Valor']}
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {categoryDataArray.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: unknown) => `R$ ${fmtBRL(Number(v))}`}
                    style={{ fill: '#475569', fontSize: '11px', fontWeight: 500 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Detalhamento ── */}
      <Card className="overflow-hidden animate-fade-in-up">
        <div className="flex justify-between items-center px-4 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-bold">Detalhamento · Período Selecionado</h2>
            <HelpHint text="Lista paginada de todas as parcelas do CR que correspondem aos filtros ativos (período, situação, categoria, unidade). Status por cor: verde = parcela já recebida; vermelho = vencida e ainda em aberto; âmbar = a receber no futuro. A coluna Valor usa ValorPago quando existir e cai para ValorParcela caso contrário." />
          </div>
          <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/15 text-xs">
            {filteredData.length} registros
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno / Sacado</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Data Pagamento</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Valor (R$)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedData.map((item, idx) => {
              const recebida = isRecebida(item);
              const vencida  = isVencida(item);
              const valorExibir = recebida && item.ValorPago > 0 ? item.ValorPago : item.ValorParcela;
              return (
                <TableRow
                  key={`${item.ContaReceberID}-${item.NumeroParcela}-${idx}`}
                  className={recebida ? 'bg-emerald-500/[0.04]' : vencida ? 'bg-red-500/[0.04]' : ''}
                >
                  <TableCell className="font-medium max-w-[200px] truncate">{item.Sacado}</TableCell>
                  <TableCell>
                    <Badge variant="category">{item.Categoria || '—'}</Badge>
                  </TableCell>
                  <TableCell>{item.NumeroParcela}</TableCell>
                  <TableCell>{item.Vencimento ? new Date(item.Vencimento).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  <TableCell className={recebida ? 'text-emerald-700 text-sm font-medium' : 'text-muted-foreground text-sm'}>
                    {item.DataPagamento || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={situacaoVariant(item.SituacaoParcela || '')}>
                      {item.SituacaoParcela || 'Sem Status'}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(
                    'text-right font-medium tabular-nums',
                    recebida ? 'text-emerald-700' : vencida ? 'text-red-600' : 'text-amber-700'
                  )}>
                    {fmtBRL(valorExibir)}
                  </TableCell>
                </TableRow>
              );
            })}
            {pagedData.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                  Nenhum registro encontrado para os filtros aplicados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-4 px-6 py-4 border-t border-border/50 bg-background/40">
            <Button variant="outline" size="sm" disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)}>
              ← Anterior
            </Button>
            <span className="text-sm text-muted-foreground">Página {tablePage + 1} de {totalPages}</span>
            <Button variant="outline" size="sm" disabled={tablePage >= totalPages - 1} onClick={() => setTablePage(p => p + 1)}>
              Próxima →
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
