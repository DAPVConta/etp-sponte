import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
  Line, ComposedChart
} from 'recharts';
import {
  FileText, AlertCircle, DollarSign, Calendar, Filter, RefreshCw, TrendingUp, Hash,
  Wifi, WifiOff, Star, ChevronDown
} from 'lucide-react';
import type { Unidade, ParcelaPagar } from '../types';
import { SyncAPI } from '../api/sync';
import { ContasPagarAPI } from '../api/contasPagar';
import { FavoritosAPI } from '../api/favoritos';
import { PlanejamentoAPI } from '../api/planejamento';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ── XML Parser ──────────────────────────────────────────────────────────────
const PARCELA_FIELDS = [
  'ContaPagarID', 'NumeroParcela', 'Sacado', 'SituacaoParcela',
  'Vencimento', 'Categoria', 'ContaID', 'TipoRecebimento',
  'FormaCobranca', 'DataPagamento', 'RetornoOperacao'
] as const;
const PARCELA_NUMERIC_FIELDS = ['ValorParcela', 'ValorPago'] as const;

const parseNumericPtBR = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const parseSponteXML = (xmlString: string): ParcelaPagar[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) return [];
  return Array.from(xmlDoc.getElementsByTagName('wsParcelaPagar')).map(item => {
    const getValue = (tag: string) => item.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    const record: Record<string, string | number> = {};
    for (const f of PARCELA_FIELDS) record[f] = getValue(f);
    for (const f of PARCELA_NUMERIC_FIELDS) record[f] = parseNumericPtBR(getValue(f));
    return record as unknown as ParcelaPagar;
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const situationVariant = (sit: string): 'success' | 'error' | 'warning' | 'info' | 'category' => {
  const s = sit.toLowerCase();
  if (s.includes('pag')) return 'success';
  if (s.includes('cancel')) return 'error';
  if (s.includes('atras') || s.includes('vencid')) return 'error';
  if (s.includes('aberto') || s.includes('pendente')) return 'warning';
  return 'info';
};

const MONTH_NAMES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f43f5e', '#84cc16', '#14b8a6', '#a855f7',
  '#d946ef', '#f97316'
];

function getDatesInRange(startISO: string, endISO: string): string[] {
  const result: string[] = [];
  const cur = new Date(startISO);
  const end = new Date(endISO);
  while (cur <= end) {
    const dd = String(cur.getDate()).padStart(2, '0');
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    result.push(`${dd}/${mm}/${cur.getFullYear()}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

interface Props { activeUnidade: Unidade | null; accentColor: string; }

export default function DashboardPage({ activeUnidade, accentColor }: Props) {
  const [data, setData] = useState<ParcelaPagar[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState<'api' | 'mock' | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    const s = new Date(d.getFullYear(), d.getMonth() - 11, 1);
    return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [apenasF, setApenasF] = useState(false);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const [planejamentoMensal, setPlanejamentoMensal] = useState<Record<string, number>>({});
  const PAGE_SIZE = 20;

  useEffect(() => {
    FavoritosAPI.listar().then(lista => setFavoritos(new Set(lista))).catch(console.error);
  }, []);

  const loadDataFromDB = useCallback(async () => {
    setLoading(true);
    setLoadingProgress('Carregando dados locais armazenados...');
    try {
      const dbData = await ContasPagarAPI.listar(activeUnidade?.id || null, startDate, endDate);
      setData(dbData);
      setDataSource('api');
    } catch (err) {
      console.error('Erro local:', err);
    } finally {
      setLoading(false);
      setLoadingProgress('');
    }
  }, [activeUnidade, startDate, endDate]);

  const syncSponteToDB = useCallback(async () => {
    const unitId = activeUnidade?.id;
    if (!unitId) return;
    setLoading(true);
    setError('');
    const codigoCliente = activeUnidade?.codigoSponte || '35695';
    const token = activeUnidade?.tokenSponte || 'fxW1Et2vS8Vf';
    try {
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
        await loadDataFromDB();
      }
      const today = new Date();
      const retro11 = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      const buildLocalISO = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
      };
      const startD = new Date(startDate); startD.setHours(12, 0, 0, 0);
      const endD = new Date(endDate); endD.setHours(12, 0, 0, 0);
      const syncStart = startD < retro11 ? startD : retro11;
      const syncEnd = endD > today ? endD : today;
      const datas = getDatesInRange(buildLocalISO(syncStart), buildLocalISO(syncEnd));
      const BATCH = 5;
      for (let i = 0; i < datas.length; i += BATCH) {
        const batch = datas.slice(i, i + BATCH);
        setLoadingProgress(`Sincronizando dias ${Math.min(i + BATCH, datas.length)} de ${datas.length}...`);
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
          await loadDataFromDB();
        }
      }
      setLastSync(new Date());
      await SyncAPI.logSync(unitId, 'sincronizacao_painel', 'sucesso', pendentes.length);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number }; message?: string };
      const msg = e?.response?.status ? `Erro HTTP ${e.response.status}` : e?.message || 'Erro desconhecido';
      setError(`Erro ao sincronizar com Sponte: ${msg}`);
      await SyncAPI.logSync(unitId, 'sincronizacao_painel', 'erro', 0, msg);
    } finally {
      setLoading(false);
      setLoadingProgress('');
    }
  }, [activeUnidade, startDate, endDate, loadDataFromDB]);

  useEffect(() => { loadDataFromDB(); }, [loadDataFromDB]);

  useEffect(() => {
    const today = new Date();
    const meses: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const unidadeIds = activeUnidade ? [activeUnidade.id] : [];
    if (!unidadeIds.length) { setPlanejamentoMensal({}); return; }
    PlanejamentoAPI.totaisMensais(unidadeIds, meses).then(setPlanejamentoMensal).catch(() => setPlanejamentoMensal({}));
  }, [activeUnidade]);

  useEffect(() => { setTablePage(0); }, [startDate, endDate, selectedCategory, selectedSituations, apenasF]);

  const parseDatePtBR = (s: string): Date | null => {
    if (!s) return null;
    const p = s.split('/');
    if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
    return new Date(s);
  };

  const availableCategories = useMemo(() => {
    const cats = new Set(data.map(d => d.Categoria).filter(Boolean));
    return ['Todas', ...Array.from(cats).sort()];
  }, [data]);

  const availableSituations = useMemo(() => {
    const sits = new Set(data.map(d => d.SituacaoParcela || 'Sem Status'));
    return Array.from(sits).sort();
  }, [data]);

  const filteredData = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate); end.setHours(23, 59, 59, 999);
    let result = data.filter(item => {
      if (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.DataPagamento) {
        const d = parseDatePtBR(item.DataPagamento);
        return d ? d >= start && d <= end : false;
      }
      if (!item.Vencimento) return false;
      const vencDate = new Date(item.Vencimento);
      return vencDate >= start && vencDate <= end;
    });
    if (selectedCategory !== 'Todas') result = result.filter(d => d.Categoria === selectedCategory);
    if (apenasF && favoritos.size > 0) result = result.filter(d => favoritos.has(d.Categoria));
    if (selectedSituations.length > 0) result = result.filter(d => selectedSituations.includes(d.SituacaoParcela || 'Sem Status'));
    return result;
  }, [data, startDate, endDate, selectedCategory, apenasF, favoritos, selectedSituations]);

  const categoryDataArray = useMemo(() => {
    const agg = filteredData.reduce((acc, curr) => {
      const cat = curr.Categoria || 'Outros';
      const val = (curr.SituacaoParcela && curr.SituacaoParcela !== 'Pendente' && curr.ValorPago > 0) ? curr.ValorPago : curr.ValorParcela;
      acc[cat] = (acc[cat] || 0) + val;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredData]);

  const monthlyDataArray = useMemo(() => {
    const today = new Date();
    const twelveMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const endOfThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    const agg: Record<string, number> = {};
    for (const item of data) {
      if (selectedCategory !== 'Todas' && item.Categoria !== selectedCategory) continue;
      if (selectedSituations.length > 0 && !selectedSituations.includes(item.SituacaoParcela || 'Sem Status')) continue;
      let refDate: Date | null = null;
      if (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.DataPagamento) refDate = parseDatePtBR(item.DataPagamento);
      else if (item.Vencimento) refDate = new Date(item.Vencimento);
      if (!refDate || refDate < twelveMonthsAgo || refDate > endOfThisMonth) continue;
      const key = `${MONTH_NAMES[refDate.getMonth()]}/${refDate.getFullYear()}`;
      const val = (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.ValorPago > 0) ? item.ValorPago : item.ValorParcela;
      agg[key] = (agg[key] || 0) + val;
    }
    return Array.from({ length: 12 }).map((_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      const key = `${MONTH_NAMES[d.getMonth()]}/${d.getFullYear()}`;
      const mesKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { name: key, value: agg[key] || 0, planejado: planejamentoMensal[mesKey] || null };
    });
  }, [data, selectedCategory, selectedSituations, planejamentoMensal]);

  const pagasNoP = useMemo(() => filteredData.filter(i => i.SituacaoParcela && i.SituacaoParcela !== 'Pendente'), [filteredData]);
  const pendentesNoP = useMemo(() => filteredData.filter(i => !i.SituacaoParcela || i.SituacaoParcela === 'Pendente'), [filteredData]);
  const totalPago = useMemo(() => pagasNoP.reduce((s, i) => s + (i.ValorPago || i.ValorParcela), 0), [pagasNoP]);
  const totalPendente = useMemo(() => pendentesNoP.reduce((s, i) => s + i.ValorParcela, 0), [pendentesNoP]);
  const uniqueCategories = useMemo(() => new Set(filteredData.map(d => d.Categoria)).size, [filteredData]);
  const pagedData = useMemo(() => filteredData.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE), [filteredData, tablePage]);
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

  const tooltipStyle = { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 16px rgba(0,0,0,0.10)' };

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">
      {/* Header */}
      <header className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3 flex-wrap"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Dashboard · Contas a Pagar
            <span className="text-[0.82rem] font-semibold px-3 py-1 rounded-full" style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}30`, WebkitTextFillColor: accentColor }}>
              {activeUnidade ? activeUnidade.nome : 'Todas as Unidades'}
            </span>
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm">
            {dataSource === 'api' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                <Wifi size={13} /> Dados do Banco Local
              </span>
            )}
            {dataSource === 'mock' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/12 text-amber-400 border border-amber-500/20 text-xs font-semibold">
                <WifiOff size={13} /> Dados de Demonstração
              </span>
            )}
            {lastSync && <span className="text-muted-foreground text-xs">Sincronizado às {lastSync.toLocaleTimeString('pt-BR')}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative z-[15]">
          {/* Situation filter */}
          <div className="relative flex items-center gap-2 bg-card/75 border border-border px-3 py-2 rounded-lg text-muted-foreground backdrop-blur focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <Filter size={15} />
            <button className="flex items-center gap-2 text-sm cursor-pointer min-w-[160px] justify-between" onClick={() => setDropdownOpen(o => !o)}>
              <span>{selectedSituations.length === 0 ? 'Todas as Situações' : `${selectedSituations.length} selecionada(s)`}</span>
              <ChevronDown size={13} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-xl p-1.5 z-[60] min-w-[220px] max-h-[360px] overflow-y-auto shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
                {availableSituations.map(sit => (
                  <label key={sit} className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg cursor-pointer text-sm text-foreground hover:bg-black/5 transition-colors">
                    <input type="checkbox" checked={selectedSituations.includes(sit)} style={{ accentColor }}
                      onChange={() => setSelectedSituations(prev => prev.includes(sit) ? prev.filter(s => s !== sit) : [...prev, sit])} />
                    {sit}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Category filter */}
          <div className="relative flex items-center gap-2 bg-card/75 border border-border px-3 py-2 rounded-lg backdrop-blur transition-all">
            {apenasF ? <Star size={14} fill="#f59e0b" className="text-amber-400 flex-shrink-0" /> : <Filter size={15} className="text-muted-foreground flex-shrink-0" />}
            <button
              className={cn("flex items-center gap-2 text-sm cursor-pointer min-w-[200px] justify-between", apenasF ? "text-amber-400 font-semibold" : "text-muted-foreground")}
              onClick={() => setCatDropdownOpen(o => !o)}
            >
              <span>{apenasF ? `★ Favoritas (${favoritos.size})` : selectedCategory === 'Todas' ? 'Todas as Categorias' : selectedCategory}</span>
              <ChevronDown size={13} />
            </button>
            {catDropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-xl p-1.5 z-[60] min-w-[260px] max-h-[360px] overflow-y-auto shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
                <button className={cn("flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors", !apenasF && selectedCategory === 'Todas' ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-black/5')} onClick={() => { setSelectedCategory('Todas'); setApenasF(false); setCatDropdownOpen(false); }}>Todas as Categorias</button>
                {favoritos.size > 0 && (
                  <button className={cn("flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors text-amber-400", apenasF ? 'bg-amber-500/15 font-bold' : 'hover:bg-black/5')} onClick={() => { setApenasF(true); setSelectedCategory('Todas'); setCatDropdownOpen(false); }}>
                    <Star size={13} fill={apenasF ? '#f59e0b' : 'none'} /> Apenas Favoritas ({favoritos.size})
                  </button>
                )}
                <div className="h-px bg-border my-1.5" />
                {availableCategories.filter(c => c !== 'Todas').map(cat => (
                  <button key={cat} className={cn("flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors truncate", !apenasF && selectedCategory === cat ? 'bg-primary/15 text-primary font-semibold' : 'text-foreground hover:bg-black/5')} onClick={() => { setSelectedCategory(cat); setApenasF(false); setCatDropdownOpen(false); }}>
                    {favoritos.has(cat) && <Star size={11} fill="#f59e0b" className="text-amber-400 flex-shrink-0" />}
                    <span className="truncate">{cat}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2 bg-card/75 border border-border px-3 py-2 rounded-lg text-muted-foreground backdrop-blur focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <Calendar size={15} />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-foreground border-none outline-none text-sm cursor-text color-scheme-light w-[130px]" />
            <span className="text-muted-foreground text-xs">até</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-foreground border-none outline-none text-sm cursor-text color-scheme-light w-[130px]" />
          </div>

          <Button
            onClick={activeUnidade ? syncSponteToDB : () => alert('Para baixar novas contas da Sponte, selecione uma escola específica no menu à esquerda.')}
            disabled={loading}
            className="gap-2 font-semibold"
            style={{ background: accentColor, boxShadow: `0 4px 14px -4px ${accentColor}66` }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Sincronizar
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700 text-sm mb-6">
          <AlertCircle size={18} /> <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
          <div className="w-11 h-11 rounded-full border-[3px] border-primary/20 animate-spin" style={{ borderTopColor: accentColor }} />
          <p className="text-muted-foreground">Conectando à API Sponte Educacional...</p>
          {loadingProgress && <p className="text-sm text-muted-foreground/70">{loadingProgress}</p>}
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4 mb-8 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
            {[
              { icon: <FileText size={22} />, color: 'bg-blue-500/15 text-blue-400', label: 'Total no Período', value: `${filteredData.length} registros` },
              { icon: <DollarSign size={22} />, color: 'bg-emerald-100 text-emerald-700', label: 'Total Pago / Quitado', value: `R$ ${fmtBRL(totalPago)}`, sub: `${pagasNoP.length} parcelas` },
              { icon: <TrendingUp size={22} />, color: 'bg-amber-100 text-amber-700', label: 'Total Pendente', value: `R$ ${fmtBRL(totalPendente)}`, sub: `${pendentesNoP.length} parcelas` },
              { icon: <Hash size={22} />, color: 'bg-violet-500/15 text-violet-400', label: 'Categorias', value: `${uniqueCategories}` },
            ].map((card, idx) => (
              <Card key={idx} className={cn("flex items-center gap-5 px-6 py-5 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl", `animate-fade-in-up`)} style={{ animationDelay: `${idx * 80}ms` }}>
                <div className={cn("w-[52px] h-[52px] rounded-xl flex items-center justify-center flex-shrink-0 relative", card.color)}>
                  <div className="absolute inset-[-2px] rounded-xl opacity-40 blur-[10px]" style={{ background: 'inherit' }} />
                  {card.icon}
                </div>
                <div>
                  <p className="text-[0.7rem] text-muted-foreground font-semibold uppercase tracking-[0.08em] mb-1">{card.label}</p>
                  <p className="text-[1.5rem] font-bold text-foreground tabular-nums tracking-tight">{card.value}</p>
                  {card.sub && <p className="text-xs text-muted-foreground">{card.sub}</p>}
                </div>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-6 mb-8">
            {/* Monthly chart */}
            <Card className="p-6 relative overflow-hidden animate-fade-in-up" style={{ animationDelay: '300ms' }}>
              <h2 className="text-base font-bold mb-5 flex items-center gap-3">
                Evolução Mensal · Últimos 12 Meses
                {selectedCategory !== 'Todas' && <Badge variant="secondary" className="text-primary bg-primary/12 border-primary/20">{selectedCategory}</Badge>}
              </h2>
              <div style={{ height: 400 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyDataArray} margin={{ top: 25, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                    <Tooltip formatter={(value, name) => { if (value == null) return [null, null]; return [`R$ ${fmtBRL(Number(value))}`, name === 'planejado' ? 'Planejado' : 'Realizado']; }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={55}>
                      {monthlyDataArray.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      <LabelList dataKey="value" position="top" formatter={(v: unknown) => Number(v) > 0 ? `R$ ${fmtBRL(Number(v))}` : ''} style={{ fill: '#475569', fontSize: '10px', fontWeight: 500 }} />
                    </Bar>
                    <Line dataKey="planejado" type="monotone" stroke={accentColor} strokeWidth={2.5} dot={{ r: 5, fill: accentColor, stroke: '#ffffff', strokeWidth: 2 }} activeDot={{ r: 7, fill: accentColor, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} name="planejado" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Category chart */}
            <Card className="p-6 relative overflow-hidden animate-fade-in-up" style={{ animationDelay: '350ms' }}>
              <h2 className="text-base font-bold mb-5">Gastos por Categoria · Período Selecionado</h2>
              <div style={{ height: Math.max(400, categoryDataArray.length * 38) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryDataArray} layout="vertical" margin={{ top: 10, right: 140, left: 220, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: '#475569', fontSize: 12 }} width={210} interval={0} />
                    <Tooltip formatter={(value) => [`R$ ${fmtBRL(Number(value))}`, 'Valor']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28}>
                      {categoryDataArray.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      <LabelList dataKey="value" position="right" formatter={(v: unknown) => `R$ ${fmtBRL(Number(v))}`} style={{ fill: '#475569', fontSize: '11px', fontWeight: 500 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Table */}
          <Card className="overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-border/50">
              <h2 className="text-base font-bold">Detalhamento · Período Selecionado</h2>
              <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/15">{filteredData.length} registros</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor / Sacado</TableHead>
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
                  const isPaga = item.SituacaoParcela && item.SituacaoParcela !== 'Pendente';
                  const valorExibir = isPaga && item.ValorPago > 0 ? item.ValorPago : item.ValorParcela;
                  return (
                    <TableRow key={`${item.ContaPagarID}-${idx}`} className={isPaga ? 'bg-emerald-500/[0.04]' : ''}>
                      <TableCell className="font-medium max-w-[200px] truncate">{item.Sacado}</TableCell>
                      <TableCell><Badge variant="category">{item.Categoria}</Badge></TableCell>
                      <TableCell>{item.NumeroParcela}</TableCell>
                      <TableCell>{item.Vencimento ? new Date(item.Vencimento).toLocaleDateString('pt-BR') : '—'}</TableCell>
                      <TableCell className={isPaga ? 'text-emerald-700 text-sm font-medium' : 'text-muted-foreground text-sm'}>{item.DataPagamento || '—'}</TableCell>
                      <TableCell><Badge variant={situationVariant(item.SituacaoParcela || '')}>{item.SituacaoParcela || 'Sem Status'}</Badge></TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", isPaga ? 'text-emerald-700' : 'text-red-600')}>{fmtBRL(valorExibir)}</TableCell>
                    </TableRow>
                  );
                })}
                {pagedData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">Nenhum registro encontrado para os filtros aplicados.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 px-6 py-4 border-t border-border/50 bg-background/40">
                <Button variant="outline" size="sm" disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)}>← Anterior</Button>
                <span className="text-sm text-muted-foreground">Página {tablePage + 1} de {totalPages}</span>
                <Button variant="outline" size="sm" disabled={tablePage >= totalPages - 1} onClick={() => setTablePage(p => p + 1)}>Próxima →</Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
