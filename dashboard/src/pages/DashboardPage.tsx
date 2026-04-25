import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
  Line, ComposedChart, ReferenceLine, Label
} from 'recharts';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FileText, AlertCircle, DollarSign, CalendarDays, Filter, RefreshCw, TrendingUp, Hash,
  Wifi, WifiOff, Star, ChevronDown, CheckCircle2, GripVertical, TrendingDown
} from 'lucide-react';
import type { Unidade, ParcelaPagar } from '../types';
import { SyncAPI } from '../api/sync';
import { SyncDiasAPI } from '../api/syncDias';
import { ContasPagarAPI } from '../api/contasPagar';
import { FavoritosAPI } from '../api/favoritos';
import { PlanejamentoAPI } from '../api/planejamento';
import { PlanoContasAPI } from '../api/planoContas';
import { cn } from '@/lib/utils';
import { useDashboardVisibility, type DashboardSectionId } from '@/hooks/use-dashboard-visibility';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from '@/components/ui/chart';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpHint } from '@/components/HelpHint';

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

const MONTH_NAMES  = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_PT_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

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
// Converte lista de YYYY-MM em startDate/endDate ISO para query no banco
function mesesParaRange(meses: string[]): { startDate: string; endDate: string } {
  const sorted = [...meses].sort();
  const [anoI, mesI] = sorted[0].split('-').map(Number);
  const [anoF, mesF] = sorted[sorted.length - 1].split('-').map(Number);
  const start = `${anoI}-${String(mesI).padStart(2,'0')}-01`;
  const lastDay = new Date(anoF, mesF, 0).getDate();
  const end   = `${anoF}-${String(mesF).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  return { startDate: start, endDate: end };
}

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

// ── Drag-and-drop section ordering ──────────────────────────────────────────
const SECTION_IDS = ['planejamento', 'evolucao', 'heatmap', 'abc', 'ranking', 'desvio_categoria', 'plan_vs_real', 'categorias', 'detalhamento'] as const;
type SectionId = (typeof SECTION_IDS)[number];

function SortableSection({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1, zIndex: isDragging ? 50 : 'auto' }}
      className="mb-4 group/section relative"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -left-1 top-2 z-10 cursor-grab active:cursor-grabbing opacity-0 group-hover/section:opacity-100 transition-opacity duration-200 p-1 rounded-md bg-background/80 border border-border/60 shadow-sm backdrop-blur-sm hover:bg-muted"
        title="Arrastar para reordenar"
      >
        <GripVertical size={14} className="text-muted-foreground" />
      </button>
      {children}
    </div>
  );
}

interface Props { activeUnidade: Unidade | null; unidades: Unidade[]; accentColor: string; }

export default function DashboardPage({ activeUnidade, unidades, accentColor }: Props) {
  const [data, setData] = useState<ParcelaPagar[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [error, setError] = useState('');
  const [dataSource, setDataSource] = useState<'api' | 'mock' | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const mesAtual = new Date().getMonth(); // 0-based, usado no gráfico evolução mensal

  const mesesDisponiveis = getMesesAno();
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([getMesAtualKey()]);
  const [showMesDropdown, setShowMesDropdown]     = useState(false);
  const mesBtnRef = useRef<HTMLButtonElement>(null);

  // Derivar startDate/endDate dos meses selecionados
  const { startDate, endDate } = useMemo(
    () => mesesSelecionados.length > 0 ? mesesParaRange(mesesSelecionados) : mesesParaRange([getMesAtualKey()]),
    [mesesSelecionados]
  );

  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [apenasF, setApenasF] = useState(false);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const mesDropdownRef = useRef<HTMLDivElement>(null);
  const [heatTooltip, setHeatTooltip] = useState<{ x: number; y: number; unidade: string; mes: string; real: number; plan: number; desvio: number } | null>(null);
  const [tablePage, setTablePage] = useState(0);
  const [abcFilter, setAbcFilter] = useState<'Todas' | 'A' | 'B' | 'C'>('Todas');

  // Fechar todos os dropdowns ao clicar fora da área de filtros
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        filtersRef.current && !filtersRef.current.contains(target) &&
        (!mesDropdownRef.current || !mesDropdownRef.current.contains(target))
      ) {
        setDropdownOpen(false);
        setCatDropdownOpen(false);
        setShowMesDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Visibilidade e ordem dos componentes (gerenciada em Configurações → Gráficos, persistido no banco)
  const { visible: sectionVisibility, isVisible: _isVisible, order: dbOrder, reorder } = useDashboardVisibility();
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(dbOrder as SectionId[]);

  // Sync order from context when it loads
  useEffect(() => {
    setSectionOrder(dbOrder as SectionId[]);
  }, [dbOrder]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSectionOrder(prev => {
        const oldIdx = prev.indexOf(active.id as SectionId);
        const newIdx = prev.indexOf(over.id as SectionId);
        const next = arrayMove(prev, oldIdx, newIdx);
        reorder(next as DashboardSectionId[]);
        return next;
      });
    }
  }, [reorder]);
  const [planejamentoRaw, setPlanejamentoRaw] = useState<Record<string, Record<string, number>>>({});
  const [gruposPlano, setGruposPlano]           = useState<string[]>([]);
  const [despesasPorGrupo, setDespesasPorGrupo] = useState<Record<string, Set<string>>>({});
  const [totaisAnuais, setTotaisAnuais]               = useState<Record<string, Record<string, number>>>({});
  const [totaisAnuaisRaw, setTotaisAnuaisRaw]         = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [realizadoAnual, setRealizadoAnual]           = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [loadingAnual, setLoadingAnual]         = useState(false);
  const PAGE_SIZE = 20;

  useEffect(() => {
    FavoritosAPI.listar().then(lista => setFavoritos(new Set(lista))).catch(console.error);
  }, []);

  // Carregar totais anuais para a tabela de planejamento e o mapa de calor
  useEffect(() => {
    if (!unidades.length) return;
    setLoadingAnual(true);
    const ano = new Date().getFullYear();
    const ids = unidades.map(u => u.id);
    Promise.all([
      PlanejamentoAPI.totaisAnuaisPorUnidade(ids, ano),
      ContasPagarAPI.totaisAnuaisPorUnidade(ids, ano),
    ])
      .then(([plano, realizado]) => {
        setTotaisAnuais(plano.totais);
        setTotaisAnuaisRaw(plano.porCategoria);
        setRealizadoAnual(realizado);
      })
      .catch(console.error)
      .finally(() => setLoadingAnual(false));
  }, [unidades]);

  // Carregar grupos do plano de contas para o filtro de categorias
  useEffect(() => {
    const ids = activeUnidade ? [activeUnidade.id] : unidades.map(u => u.id);
    if (!ids.length) return;
    Promise.all(ids.map(id => PlanoContasAPI.listarPorUnidade(id).catch(() => [])))
      .then(results => {
        const grupos = new Set<string>();
        const despMap: Record<string, Set<string>> = {};
        for (const items of results) {
          for (const item of items) {
            if (item.tipo === 'grupo') grupos.add(item.nome);
            if (item.tipo === 'despesa' && item.grupoNome) {
              if (!despMap[item.grupoNome]) despMap[item.grupoNome] = new Set();
              despMap[item.grupoNome].add(item.nome);
            }
          }
        }
        setGruposPlano([...grupos].sort((a, b) => a.localeCompare(b, 'pt-BR')));
        setDespesasPorGrupo(despMap);
      })
      .catch(console.error);
  }, [activeUnidade, unidades]);

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
        // Registrar dias sincronizados na tabela de controle
        const diasParaRegistrar = batch.map((dataPtBR, idx) => {
          const [dd, mm, yyyy] = dataPtBR.split('/');
          return { data: `${yyyy}-${mm}-${dd}`, registros: batchResults[idx].length };
        });
        await SyncDiasAPI.registrarBatch(unitId, diasParaRegistrar, 'cp');
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
    // Se há unidade ativa usa ela; senão usa todas as unidades disponíveis
    const unidadeIds = activeUnidade
      ? [activeUnidade.id]
      : unidades.map(u => u.id);
    if (!unidadeIds.length) { setPlanejamentoRaw({}); return; }
    const ano = new Date().getFullYear();
    const meses12 = Array.from({ length: 12 }, (_, i) =>
      `${ano}-${String(i + 1).padStart(2, '0')}`
    );
    PlanejamentoAPI.totaisMensaisPorCategoria(unidadeIds, meses12)
      .then(setPlanejamentoRaw)
      .catch(() => setPlanejamentoRaw({}));
  }, [activeUnidade, unidades]);

  // Totais planejados por mês respeitando o filtro de categoria ativo.
  // As chaves em etp_planejamento.categoria seguem o formato:
  //   "G::{grupoNome}"          → planejamento direto do grupo
  //   "SG::{grupoNome}::{sub}"  → planejamento de sub-grupo
  const planejamentoMensal = useMemo(() => {
    const getGrupoFromKey = (key: string): string => {
      if (key.startsWith('G::')) return key.slice(3);
      if (key.startsWith('SG::')) return key.slice(4).split('::')[0];
      return key; // fallback: chave bruta (formato antigo)
    };
    const totais: Record<string, number> = {};
    for (const [mes, catMap] of Object.entries(planejamentoRaw)) {
      let total = 0;
      for (const [cat, valor] of Object.entries(catMap)) {
        if (selectedCategory === 'Todas') {
          total += valor;
        } else {
          const grupoDoItem = getGrupoFromKey(cat);
          if (grupoDoItem === selectedCategory) total += valor;
        }
      }
      totais[mes] = total;
    }
    return totais;
  }, [planejamentoRaw, selectedCategory]);

  useEffect(() => { setTablePage(0); }, [mesesSelecionados, selectedCategory, selectedSituations, apenasF]);

  const parseDatePtBR = (s: string): Date | null => {
    if (!s) return null;
    const p = s.split('/');
    if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
    return new Date(s);
  };

  const availableCategories = useMemo(() => {
    // Usa grupos do plano de contas; fallback para categorias dos dados se ainda não carregou
    if (gruposPlano.length > 0) return ['Todas', ...gruposPlano];
    const cats = new Set(data.map(d => d.Categoria).filter(Boolean));
    return ['Todas', ...Array.from(cats).sort()];
  }, [gruposPlano, data]);

  const availableSituations = useMemo(() => {
    const sits = new Set(data.map(d => d.SituacaoParcela || 'Sem Status'));
    return Array.from(sits).sort();
  }, [data]);

  const filteredData = useMemo(() => {
    const mesesSet = new Set(mesesSelecionados);
    const getItemMes = (item: ParcelaPagar): string | null => {
      if (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.DataPagamento) {
        const d = parseDatePtBR(item.DataPagamento);
        if (d) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (item.Vencimento) {
        const d = new Date(item.Vencimento);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      return null;
    };
    let result = data.filter(item => {
      const mes = getItemMes(item);
      return mes ? mesesSet.has(mes) : false;
    });
    if (selectedCategory !== 'Todas') {
      const despesasDoGrupo = despesasPorGrupo[selectedCategory];
      if (despesasDoGrupo && despesasDoGrupo.size > 0) {
        const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
        const normSet = new Set([...despesasDoGrupo].map(norm));
        result = result.filter(d => normSet.has(norm(d.Categoria || '')));
      } else {
        result = result.filter(d => d.Categoria === selectedCategory);
      }
    }
    if (apenasF && favoritos.size > 0) result = result.filter(d => favoritos.has(d.Categoria));
    if (selectedSituations.length > 0) result = result.filter(d => selectedSituations.includes(d.SituacaoParcela || 'Sem Status'));
    return result;
  }, [data, mesesSelecionados, selectedCategory, apenasF, favoritos, selectedSituations]);

  const categoryDataArray = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const catToGrupo: Record<string, string> = {};
    for (const [grupo, despesas] of Object.entries(despesasPorGrupo)) {
      for (const d of despesas) catToGrupo[norm(d)] = grupo;
    }
    const agg = filteredData.reduce((acc, curr) => {
      const cat = curr.Categoria || 'Outros';
      const grupo = catToGrupo[norm(cat)] || cat;
      const val = (curr.SituacaoParcela && curr.SituacaoParcela !== 'Pendente' && curr.ValorPago > 0) ? curr.ValorPago : curr.ValorParcela;
      acc[grupo] = (acc[grupo] || 0) + val;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredData, despesasPorGrupo]);

  const abcDataArray = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    // Reverse map: normalised despesa name → grupo name
    const catToGrupo: Record<string, string> = {};
    for (const [grupo, despesas] of Object.entries(despesasPorGrupo)) {
      for (const d of despesas) catToGrupo[norm(d)] = grupo;
    }
    // Aggregate filtered data by grupo
    const agg: Record<string, number> = {};
    for (const item of filteredData) {
      const cat = item.Categoria || '';
      const val = (item.SituacaoParcela && item.SituacaoParcela !== 'Pendente' && item.ValorPago > 0) ? item.ValorPago : item.ValorParcela;
      const grupo = catToGrupo[norm(cat)] || cat || 'Outros';
      agg[grupo] = (agg[grupo] || 0) + val;
    }
    const sorted = Object.entries(agg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const total = sorted.reduce((s, d) => s + d.value, 0);
    if (total === 0) return [];
    let cumul = 0;
    return sorted.map(d => {
      const pct = (d.value / total) * 100;
      cumul += pct;
      const classe: 'A' | 'B' | 'C' = cumul <= 80 ? 'A' : cumul <= 95 ? 'B' : 'C';
      return { name: d.name, value: d.value, pct, cumul, classe };
    });
  }, [filteredData, despesasPorGrupo]);

  const monthlyDataArray = useMemo(() => {
    const ano = new Date().getFullYear();
    const agg: Record<string, number> = {};
    for (const item of data) {
      if (selectedCategory !== 'Todas') {
        const despesasDoGrupo = despesasPorGrupo[selectedCategory];
        if (despesasDoGrupo && despesasDoGrupo.size > 0) {
          const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
          const normSet = new Set([...despesasDoGrupo].map(norm));
          if (!normSet.has(norm(item.Categoria || ''))) continue;
        } else {
          if (item.Categoria !== selectedCategory) continue;
        }
      }
      if (selectedSituations.length > 0 && !selectedSituations.includes(item.SituacaoParcela || 'Sem Status')) continue;
      // Só considerar itens pagos (com data de pagamento real)
      if (!item.SituacaoParcela || item.SituacaoParcela === 'Pendente' || !item.DataPagamento) continue;
      const refDate = parseDatePtBR(item.DataPagamento);
      if (!refDate || refDate.getFullYear() !== ano) continue;
      const mesKey = `${ano}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
      const val = item.ValorPago > 0 ? item.ValorPago : item.ValorParcela;
      agg[mesKey] = (agg[mesKey] || 0) + val;
    }
    const mesAtual = new Date().getMonth(); // 0-based
    return Array.from({ length: 12 }, (_, i) => {
      const mesKey = `${ano}-${String(i + 1).padStart(2, '0')}`;
      const label  = `${MONTH_NAMES[i]}/${ano}`;
      const plan   = planejamentoMensal[mesKey];
      const hasPlan = plan != null && plan > 0;
      return {
        name:      label,
        value:     agg[mesKey] || 0,
        planejado:         hasPlan && i <= mesAtual ? plan : null,
        planejadoProj:     hasPlan && i >= mesAtual - 1 ? plan : null,
        planejadoProjLbl:  hasPlan && i > mesAtual ? plan : null,
      };
    });
  }, [data, selectedCategory, selectedSituations, planejamentoMensal]);

  // Dados empilhados por unidade (usado no gráfico quando "Todas as Unidades" está ativo)
  const monthlyDataArrayStacked = useMemo(() => {
    if (activeUnidade || !unidades.length) return null;
    const ano = new Date().getFullYear();
    const normStr = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return Array.from({ length: 12 }, (_, i) => {
      const mesKey = `${ano}-${String(i + 1).padStart(2, '0')}`;
      const entry: Record<string, string | number | null> = { name: `${MONTH_NAMES[i]}/${ano}` };
      for (const u of unidades) {
        if (selectedCategory === 'Todas') {
          entry[u.id] = Object.values(realizadoAnual[u.id]?.[mesKey] ?? {}).reduce((s, v) => s + v, 0) || 0;
        } else {
          const despesasDoGrupo = despesasPorGrupo[selectedCategory];
          const normSet = despesasDoGrupo && despesasDoGrupo.size > 0
            ? new Set([...despesasDoGrupo].map(normStr)) : null;
          entry[u.id] = Object.entries(realizadoAnual[u.id]?.[mesKey] ?? {})
            .filter(([cat]) => normSet ? normSet.has(normStr(cat)) : cat === selectedCategory)
            .reduce((s, [, v]) => s + v, 0) || 0;
        }
      }
      const plan = planejamentoMensal[mesKey];
      const hasPlan = plan != null && plan > 0;
      const mesAtual = new Date().getMonth();
      entry.planejado     = hasPlan && i <= mesAtual ? plan : null;
      entry.planejadoProj = hasPlan && i >= mesAtual ? plan : null;
      return entry;
    });
  }, [activeUnidade, unidades, realizadoAnual, selectedCategory, despesasPorGrupo, planejamentoMensal]);

  const pagasNoP = useMemo(() => filteredData.filter(i => i.SituacaoParcela && i.SituacaoParcela !== 'Pendente'), [filteredData]);
  const pendentesNoP = useMemo(() => filteredData.filter(i => !i.SituacaoParcela || i.SituacaoParcela === 'Pendente'), [filteredData]);
  const totalPago = useMemo(() => pagasNoP.reduce((s, i) => s + (i.ValorPago || i.ValorParcela), 0), [pagasNoP]);
  const totalPendente = useMemo(() => pendentesNoP.reduce((s, i) => s + i.ValorParcela, 0), [pendentesNoP]);
  const uniqueCategories = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const catToGrupo: Record<string, string> = {};
    for (const [grupo, despesas] of Object.entries(despesasPorGrupo)) {
      for (const d of despesas) catToGrupo[norm(d)] = grupo;
    }
    return new Set(filteredData.map(d => catToGrupo[norm(d.Categoria || '')] || d.Categoria)).size;
  }, [filteredData, despesasPorGrupo]);
  const pagedData = useMemo(() => filteredData.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE), [filteredData, tablePage]);
  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

  const tooltipStyle = { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 16px rgba(0,0,0,0.10)' };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-4 animate-fade-in">
      {/* Header */}
      <header ref={filtersRef} className="flex justify-between items-center mb-3 pb-3 border-b border-border/50 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[1.2rem] font-extrabold tracking-tight flex items-center gap-2 flex-wrap"
              style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Dashboard · Contas a Pagar
            </h1>
            {dataSource === 'api' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[0.65rem] font-semibold">
                <Wifi size={11} /> Banco Local
              </span>
            )}
            {lastSync && <span className="text-muted-foreground text-[0.65rem]">Sync {lastSync.toLocaleTimeString('pt-BR')}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative z-[15]">
          {/* Situation filter */}
          <div className="relative flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground backdrop-blur transition-all">
            <Filter size={13} />
            <button className="flex items-center gap-1.5 text-xs cursor-pointer min-w-[130px] justify-between" onClick={() => setDropdownOpen(o => !o)}>
              <span>{selectedSituations.length === 0 ? 'Todas as Situações' : `${selectedSituations.length} selecionada(s)`}</span>
              <ChevronDown size={11} />
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
          <div className="relative flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg backdrop-blur transition-all">
            {apenasF ? <Star size={12} fill="#f59e0b" className="text-amber-400 flex-shrink-0" /> : <Filter size={13} className="text-muted-foreground flex-shrink-0" />}
            <button
              className={cn("flex items-center gap-1.5 text-xs cursor-pointer min-w-[160px] justify-between", apenasF ? "text-amber-400 font-semibold" : "text-muted-foreground")}
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

          {/* Month selector */}
          <div className="relative">
            <button
              ref={mesBtnRef}
              className={cn("flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg text-xs transition-all min-w-[150px] justify-between backdrop-blur", showMesDropdown ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40")}
              onClick={() => setShowMesDropdown(d => !d)}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays size={13} style={{ color: accentColor }} />
                <span className={cn("text-xs", mesesSelecionados.length > 0 && "text-foreground font-medium")}>
                  {mesesSelecionados.length === 0 ? 'Selecionar mês'
                    : mesesSelecionados.length === 1 ? (mesesDisponiveis.find(m => m.value === mesesSelecionados[0])?.label || mesesSelecionados[0])
                    : `${mesesSelecionados.length} meses`}
                </span>
              </div>
              <ChevronDown size={11} className={cn("text-muted-foreground transition-transform", showMesDropdown && "rotate-180")} />
            </button>
            {showMesDropdown && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setShowMesDropdown(false)} />
                <div
                  ref={mesDropdownRef}
                  className="fixed z-[9999] bg-white border border-border rounded-xl p-1.5 shadow-2xl"
                  style={{
                    top: (mesBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    left: mesBtnRef.current?.getBoundingClientRect().left ?? 0,
                    minWidth: Math.max(mesBtnRef.current?.getBoundingClientRect().width ?? 0, 210),
                  }}
                >
                  {mesesDisponiveis.map(m => {
                    const isSel    = mesesSelecionados.includes(m.value);
                    const isAtual  = m.value === getMesAtualKey();
                    return (
                      <button key={m.value}
                        className={cn("flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-all", isSel ? "font-semibold" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}
                        style={isSel ? { background: `${accentColor}18`, color: accentColor } : {}}
                        onClick={() => {
                          setMesesSelecionados(prev =>
                            prev.includes(m.value) ? (prev.length === 1 ? prev : prev.filter(x => x !== m.value)) : [...prev, m.value].sort()
                          );
                        }}
                      >
                        {isSel
                          ? <CheckCircle2 size={11} className="flex-shrink-0" />
                          : <span className="w-3 h-3 rounded-full border border-border flex-shrink-0" />}
                        {m.label}
                        {isAtual && <span className="ml-auto text-[0.6rem] font-bold px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Atual</span>}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body
            )}
          </div>


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
      ) : (() => {
        const visibleIds = sectionOrder.filter(id => {
          // Respeitar configuração de visibilidade
          if (!sectionVisibility.has(id)) return false;
          if (id === 'heatmap') return unidades.length > 0;
          if (id === 'ranking') return unidades.length > 0;
          if (id === 'desvio_categoria') return unidades.length > 0;
          if (id === 'plan_vs_real') return unidades.length > 0;
          if (id === 'abc') return abcDataArray.length > 0;
          return true;
        });
        const renderSection = (sid: SectionId): React.ReactNode => {
          switch (sid) {
            case 'planejamento': return (
          <Card className="overflow-hidden border-0 shadow-md" style={{ borderTop: `3px solid ${accentColor}` }}>
            <div className="px-5 py-2.5 flex items-center justify-between" style={{ background: accentColor }}>
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-white/80" />
                <span className="text-[0.72rem] font-bold text-white uppercase tracking-widest">Planejamento Anual {new Date().getFullYear()}</span>
                <HelpHint text="Tabela comparativa do plano anual versus realizado por unidade × grupo contábil. Linha colorida = plano; abaixo aparece o realizado e o desvio (verde = abaixo do plano, vermelho = acima). O clique em uma linha filtra os cartões e gráficos abaixo pela categoria/unidade selecionada." className="text-white/70 hover:text-white" />
              </div>
              {loadingAnual && <RefreshCw size={11} className="animate-spin text-white/70" />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: `${accentColor}15` }}>
                    <th className="text-left px-4 py-2 font-bold text-[0.6rem] text-slate-500 uppercase tracking-widest whitespace-nowrap min-w-[150px] border-b border-r" style={{ borderColor: `${accentColor}25` }}>
                      Unidade
                    </th>
                    {MESES_PT_FULL.map((m, i) => {
                      const mesVal  = `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                      const isAtual = mesVal === getMesAtualKey();
                      return (
                        <th key={m} className="text-right px-3 py-2 font-bold text-[0.6rem] uppercase tracking-widest whitespace-nowrap border-b min-w-[80px]"
                          style={{ borderColor: `${accentColor}25`, background: isAtual ? accentColor : undefined, color: isAtual ? '#fff' : undefined }}>
                          {m.substring(0, 3)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {unidades.map((u, idx) => {
                    const rowTotais = totaisAnuais[u.id] || {};
                    return (
                      <tr key={u.id} className="hover:brightness-95 transition-all border-b" style={{ borderColor: `${accentColor}15`, background: idx % 2 === 0 ? '#fff' : `${accentColor}05` }}>
                        <td className="px-4 py-2 whitespace-nowrap border-r" style={{ borderColor: `${accentColor}20` }}>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: u.cor }} />
                            <span className="font-bold text-[0.68rem]" style={{ color: u.cor }}>{u.nome}</span>
                          </div>
                        </td>
                        {Array.from({ length: 12 }, (_, i) => {
                          const mesVal  = `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                          const val     = rowTotais[mesVal] || 0;
                          const isAtual = mesVal === getMesAtualKey();
                          return (
                            <td key={i} className="text-right px-3 py-2 tabular-nums text-[0.68rem]"
                              style={{ background: isAtual ? `${accentColor}12` : undefined, color: val === 0 ? '#d1d5db' : isAtual ? accentColor : '#334155', fontWeight: val > 0 ? 600 : 400 }}>
                              {val === 0 ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(val)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {unidades.length > 1 && (
                    <tr style={{ background: accentColor }}>
                      <td className="px-4 py-2.5 whitespace-nowrap border-r border-white/20">
                        <span className="font-extrabold text-[0.65rem] uppercase tracking-widest text-white">Total Geral</span>
                      </td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const mesVal  = `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                        const total   = unidades.reduce((s, u) => s + (totaisAnuais[u.id]?.[mesVal] || 0), 0);
                        const isAtual = mesVal === getMesAtualKey();
                        return (
                          <td key={i} className="text-right px-3 py-2.5 tabular-nums text-[0.68rem] font-extrabold"
                            style={{ color: total === 0 ? 'rgba(255,255,255,0.3)' : '#fff', background: isAtual ? 'rgba(0,0,0,0.15)' : undefined }}>
                            {total === 0 ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(total)}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
            );
            case 'evolucao': return (
            <Card className="p-4 relative overflow-hidden animate-fade-in-up" style={{ animationDelay: '300ms' }}>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                Evolução Mensal · {new Date().getFullYear()}
                {selectedCategory !== 'Todas' && <Badge variant="secondary" className="text-primary bg-primary/12 border-primary/20 text-xs">{selectedCategory}</Badge>}
                <HelpHint text="Evolução mês a mês do realizado (barras) e do planejado (linha) no ano corrente. Quando nenhuma unidade específica está ativa, as barras ficam empilhadas por unidade. O realizado soma ValorPago (ou ValorParcela quando não houver pagamento) pela data de pagamento. O planejado vem da tabela de planejamento anual." />
              </h2>
              {(() => {
                  const isStacked = !activeUnidade && !!monthlyDataArrayStacked;
                  const chartData = isStacked ? monthlyDataArrayStacked! : monthlyDataArray;
                  const fmtCompact = (v: unknown) => Number(v) > 0 ? new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v)) : '';
                  // Cor mais clara para a linha de planejado (mix com branco ~40%)
                  const lighten = (hex: string, pct: number) => {
                    const c = hex.replace('#', '');
                    const r = parseInt(c.substring(0, 2), 16);
                    const g = parseInt(c.substring(2, 4), 16);
                    const b = parseInt(c.substring(4, 6), 16);
                    const lr = Math.round(r + (255 - r) * pct);
                    const lg = Math.round(g + (255 - g) * pct);
                    const lb = Math.round(b + (255 - b) * pct);
                    return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
                  };
                  const planColor = lighten(accentColor, 0.35);
                  return (
                    <>
                    <div style={{ height: 280 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 40, right: 20, left: 20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                          <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10, fill: '#64748b' }} />
                          <YAxis stroke="#94a3b8" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `R$ ${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} width={60} />
                          <Tooltip
                            formatter={(value, name) => {
                              if (value == null || value === 0) return [null, null];
                              if (name === 'planejado') return [`R$ ${fmtBRL(Number(value))}`, 'Planejado'];
                              if (name === 'planejadoProj') return [`R$ ${fmtBRL(Number(value))}`, 'Projeção'];
                              if (isStacked) {
                                const u = unidades.find(u => u.id === name);
                                return [`R$ ${fmtBRL(Number(value))}`, u?.nome || String(name)];
                              }
                              return [`R$ ${fmtBRL(Number(value))}`, 'Realizado'];
                            }}
                            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                            contentStyle={tooltipStyle}
                          />
                          {isStacked ? (
                            unidades.map((u, idx) => (
                              <Bar key={u.id} dataKey={u.id} stackId="stack" fill={u.cor} maxBarSize={50}
                                radius={idx === unidades.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                                {idx === unidades.length - 1 && (
                                  <LabelList
                                    valueAccessor={(entry: Record<string, unknown>) => unidades.reduce((s, uu) => s + (Number(entry[uu.id]) || 0), 0)}
                                    position="top" formatter={fmtCompact}
                                    style={{ fill: '#475569', fontSize: '11px', fontWeight: 700 }} />
                                )}
                              </Bar>
                            ))
                          ) : (
                            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={50}>
                              {monthlyDataArray.map((_, i) => <Cell key={i} fill={accentColor} />)}
                              <LabelList dataKey="value" position="insideTop" formatter={fmtCompact}
                                fill="#ffffff" fontSize={11} fontWeight={800}
                                stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
                            </Bar>
                          )}
                          <Line dataKey="planejado" type="monotone" stroke={planColor} strokeWidth={2}
                            dot={{ r: 4, fill: planColor, stroke: '#ffffff', strokeWidth: 2 }}
                            activeDot={{ r: 6, fill: planColor, stroke: '#fff', strokeWidth: 2 }}
                            connectNulls={true} name="planejado">
                            <LabelList dataKey="planejado" position="bottom" offset={10}
                              formatter={(v: unknown) => v != null && Number(v) > 0 ? fmtCompact(v) : ''}
                              fill={planColor} fontSize={10} fontWeight={700} />
                          </Line>
                          <Line dataKey="planejadoProj" type="monotone" stroke={planColor} strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={(props: Record<string, unknown>) => {
                              const idx = props.index as number;
                              if (idx <= mesAtual) return <g key={`proj-dot-${idx}`} />;
                              return <circle key={`proj-dot-${idx}`} cx={props.cx as number} cy={props.cy as number} r={3} fill={planColor} stroke="#ffffff" strokeWidth={2} />;
                            }}
                            activeDot={{ r: 5, fill: planColor, stroke: '#fff', strokeWidth: 2 }}
                            connectNulls={true} name="planejadoProj">
                            <LabelList
                              content={(rawProps: unknown) => { const props = rawProps as Record<string, unknown>;
                                const payload = props.value as Record<string, unknown> | undefined;
                                const lbl = payload?.planejadoProjLbl;
                                if (lbl == null || Number(lbl) <= 0) return null;
                                return (
                                  <text
                                    key={`proj-lbl-${props.index}`}
                                    x={props.x as number}
                                    y={(props.y as number) + 16}
                                    textAnchor="middle"
                                    fill={planColor}
                                    fontSize={10}
                                    fontWeight={700}
                                  >
                                    {fmtCompact(lbl)}
                                  </text>
                                );
                              }}
                            />
                          </Line>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-5 mt-2 text-[0.7rem] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: activeUnidade ? accentColor : '#94a3b8' }} />
                        Valor Pago
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg width="20" height="3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={planColor} strokeWidth="2" /></svg>
                        Planejado
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg width="20" height="3"><line x1="0" y1="1.5" x2="20" y2="1.5" stroke={planColor} strokeWidth="2" strokeDasharray="4 3" /></svg>
                        Projeção
                      </span>
                    </div>
                    </>
                  );
                })()}
            </Card>
            );
            case 'heatmap': return (
              <Card className="p-4 animate-fade-in-up" style={{ animationDelay: '325ms' }}>
                <h2 className="text-sm font-bold mb-0.5 flex items-center gap-1.5">Mapa de calor — desvio planejado vs realizado por mês<HelpHint text="Matriz grupo × mês. Cada célula mostra o desvio percentual entre o realizado e o planejado no período. Vermelho = realizado acima do plano (estouro); verde = abaixo do plano (economia); intensidade proporcional ao desvio. Útil para detectar padrões sazonais ou grupos recorrentemente fora do orçamento." /></h2>
                <p className="text-[0.7rem] text-muted-foreground mb-3">
                  Intensidade da cor = magnitude do desvio · <span className="text-red-500 font-medium">vermelho = acima do plano</span> · <span className="text-emerald-600 font-medium">verde = abaixo</span>
                </p>
                {(() => {
                  const ano = new Date().getFullYear();
                  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
                  const mesLabel = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
                  const normStr = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                  const getGrupoFromKey = (key: string): string => {
                    if (key.startsWith('G::')) return key.slice(3);
                    if (key.startsWith('SG::')) return key.slice(4).split('::')[0];
                    return key;
                  };
                  const getValues = (uid: string, mes: string): { plan: number; real: number; desvio: number | null } => {
                    let plan: number;
                    let real: number;
                    if (selectedCategory === 'Todas') {
                      plan = totaisAnuais[uid]?.[mes] ?? 0;
                      real = Object.values(realizadoAnual[uid]?.[mes] ?? {}).reduce((s, v) => s + v, 0);
                    } else {
                      plan = Object.entries(totaisAnuaisRaw[uid]?.[mes] ?? {})
                        .filter(([k]) => getGrupoFromKey(k) === selectedCategory)
                        .reduce((s, [, v]) => s + v, 0);
                      const despesasDoGrupo = despesasPorGrupo[selectedCategory];
                      const normSet = despesasDoGrupo && despesasDoGrupo.size > 0
                        ? new Set([...despesasDoGrupo].map(normStr))
                        : null;
                      real = Object.entries(realizadoAnual[uid]?.[mes] ?? {})
                        .filter(([cat]) => normSet ? normSet.has(normStr(cat)) : cat === selectedCategory)
                        .reduce((s, [, v]) => s + v, 0);
                    }
                    const desvio = plan > 0 ? (real - plan) / plan * 100 : null;
                    return { plan, real, desvio };
                  };
                  const cellColor = (d: number | null): string => {
                    if (d === null) return 'transparent';
                    const abs = Math.abs(d);
                    if (d > 0) {
                      if (abs >= 15) return '#ef4444';
                      if (abs >= 8)  return '#f87171';
                      if (abs >= 3)  return '#fca5a5';
                      return '#fecaca';
                    } else {
                      if (abs >= 15) return '#059669';
                      if (abs >= 8)  return '#34d399';
                      if (abs >= 3)  return '#6ee7b7';
                      return '#a7f3d0';
                    }
                  };
                  const textColor = (d: number | null): string => {
                    if (d === null) return '#94a3b8';
                    const abs = Math.abs(d);
                    if (abs >= 8) return '#ffffff';
                    return d > 0 ? '#991b1b' : '#065f46';
                  };
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr>
                            <th className="text-left text-muted-foreground font-medium py-1.5 pr-3 min-w-[110px]" />
                            {mesLabel.map((m, i) => (
                              <th key={i} className="text-center text-muted-foreground font-medium py-1.5 px-1 min-w-[56px]">{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(activeUnidade ? unidades.filter(u => u.id === activeUnidade.id) : unidades).map(u => (
                            <tr key={u.id}>
                              <td className="pr-3 py-1 font-semibold text-foreground truncate max-w-[110px]" title={u.nome}>
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: u.cor }} />
                                  <span className="truncate">{u.nome}</span>
                                </div>
                              </td>
                              {meses.map((mes, i) => {
                                const { plan, real, desvio: d } = getValues(u.id, mes);
                                const bg = cellColor(d);
                                const tc = textColor(d);
                                const isNoData = d === null;
                                return (
                                  <td key={i} className="py-1 px-0.5 text-center">
                                    <div
                                      className="rounded-md mx-auto flex items-center justify-center font-semibold transition-all cursor-default"
                                      style={{
                                        width: 52, height: 32,
                                        background: isNoData ? undefined : bg,
                                        backgroundImage: isNoData ? 'repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 1px, transparent 1px, transparent 6px)' : undefined,
                                        color: tc,
                                        fontSize: '0.7rem',
                                      }}
                                      onMouseEnter={e => {
                                        if (isNoData) return;
                                        setHeatTooltip({ x: e.clientX, y: e.clientY, unidade: u.nome, mes: mesLabel[i], real, plan, desvio: d! });
                                      }}
                                      onMouseMove={e => {
                                        if (!isNoData) setHeatTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null);
                                      }}
                                      onMouseLeave={() => setHeatTooltip(null)}
                                    >
                                      {d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)}%` : ''}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Legend */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                        <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                          <span>Abaixo do plano</span>
                          {['#059669','#34d399','#6ee7b7','#a7f3d0'].map(c => (
                            <span key={c} className="inline-block w-5 h-3.5 rounded" style={{ background: c }} />
                          ))}
                          <span className="inline-block w-5 h-3.5 rounded bg-slate-200" />
                          {['#fecaca','#fca5a5','#f87171','#ef4444'].map(c => (
                            <span key={c} className="inline-block w-5 h-3.5 rounded" style={{ background: c }} />
                          ))}
                          <span>Acima do plano</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                          <div className="w-5 h-3.5 rounded" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 1px, transparent 1px, transparent 6px)', border: '1px solid #e2e8f0' }} />
                          <span>= sem dados</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </Card>
            );
            case 'abc': return (
              <Card className="p-5 animate-fade-in-up" style={{ animationDelay: '340ms' }}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold flex items-center gap-1.5">Curva ABC — Concentração de gastos por grupo<HelpHint text="Classificação de Pareto aplicada ao realizado do período. Os grupos são ordenados por valor decrescente e a curva cumulativa identifica a classe A (até ~80% do gasto), B (próximos ~15%) e C (~5% restantes). Ajuda a priorizar os grupos que mais pesam no orçamento." /></h2>
                    <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                      Classificação de Pareto · <span className="text-indigo-500 font-medium">A = ~80% do gasto</span> · <span className="text-amber-500 font-medium">B = ~15%</span> · <span className="text-slate-400 font-medium">C = ~5%</span>
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums text-right">
                    {(() => {
                      const t = abcDataArray.reduce((s, d) => s + d.value, 0);
                      const fmtK = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : v.toFixed(0);
                      return <>Total: <span className="font-semibold text-foreground">R$ {fmtK(t)}</span> · {abcDataArray.length} grupos</>;
                    })()}
                  </div>
                </div>

                {/* Summary cards */}
                {(() => {
                  const grand = abcDataArray.reduce((s, d) => s + d.value, 0);
                  const fmtK = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : v.toFixed(0);
                  const classes = (['A', 'B', 'C'] as const).map(cl => {
                    const items = abcDataArray.filter(d => d.classe === cl);
                    const clTotal = items.reduce((s, d) => s + d.value, 0);
                    return { cl, count: items.length, total: clTotal, pctItems: abcDataArray.length ? Math.round(items.length / abcDataArray.length * 100) : 0, pctTotal: grand ? Math.round(clTotal / grand * 100) : 0 };
                  });
                  const colorCfg = {
                    A: { accent: '#6366f1', light: '#eef2ff', border: '#c7d2fe', text: 'text-indigo-700' },
                    B: { accent: '#f59e0b', light: '#fffbeb', border: '#fde68a', text: 'text-amber-700' },
                    C: { accent: '#94a3b8', light: '#f8fafc', border: '#e2e8f0', text: 'text-slate-600' },
                  };
                  return (
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      {classes.map(({ cl, total, pctItems, pctTotal }) => (
                        <div key={cl} className="rounded-xl p-3.5 border relative overflow-hidden" style={{ background: colorCfg[cl].light, borderColor: colorCfg[cl].border }}>
                          <div className="absolute top-0 left-0 h-1 w-full" style={{ background: colorCfg[cl].accent }} />
                          <div className="text-[0.7rem] text-muted-foreground font-medium">Classe {cl} · {pctItems}% dos itens</div>
                          <div className={`text-xl font-bold mt-1 ${colorCfg[cl].text}`}>R$ {fmtK(total)}</div>
                          <div className="text-[0.7rem] font-semibold mt-0.5" style={{ color: colorCfg[cl].accent }}>{pctTotal}% do gasto total</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Filter pills */}
                <div className="flex items-center gap-2 mb-5 flex-wrap">
                  <span className="text-xs text-muted-foreground font-medium">Filtrar por classe:</span>
                  {(['A', 'B', 'C'] as const).map(cl => {
                    const active = abcFilter === cl;
                    const colors = { A: { bg: '#6366f1', idle: '#6366f1' }, B: { bg: '#f59e0b', idle: '#f59e0b' }, C: { bg: '#94a3b8', idle: '#94a3b8' } };
                    return (
                      <button key={cl} onClick={() => setAbcFilter(abcFilter === cl ? 'Todas' : cl)}
                        className="px-3.5 py-1.5 rounded-full text-xs font-semibold border-2 transition-all duration-200"
                        style={{
                          borderColor: colors[cl].bg,
                          background: active ? colors[cl].bg : 'transparent',
                          color: active ? '#fff' : colors[cl].idle,
                          boxShadow: active ? `0 2px 8px ${colors[cl].bg}40` : 'none',
                        }}>
                        <span className="mr-1.5" style={{ opacity: active ? 1 : 0.7 }}>●</span>Classe {cl}
                      </button>
                    );
                  })}
                </div>

                {/* Pareto chart */}
                {(() => {
                  const chartData = abcFilter === 'Todas' ? abcDataArray : abcDataArray.filter(d => d.classe === abcFilter);
                  const maxPct = Math.max(...chartData.map(d => d.pct), 5);
                  const clrMap: Record<string, string> = { A: '#6366f1', B: '#f59e0b', C: '#94a3b8' };
                  const clrMapLight: Record<string, string> = { A: '#818cf8', B: '#fbbf24', C: '#cbd5e1' };
                  return (
                    <div style={{ height: Math.max(340, 160 + chartData.length * 22) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 20, right: 55, left: 5, bottom: 70 }} barCategoryGap="18%">
                          <defs>
                            {(['A', 'B', 'C'] as const).map(cl => (
                              <linearGradient key={cl} id={`abcGrad${cl}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={clrMapLight[cl]} stopOpacity={1} />
                                <stop offset="100%" stopColor={clrMap[cl]} stopOpacity={1} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: '#475569', fontSize: 11, fontWeight: 500 }}
                            angle={-30}
                            textAnchor="end"
                            interval={0}
                            height={75}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                            tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 17) + '…' : v}
                          />
                          <YAxis
                            yAxisId="left"
                            orientation="left"
                            domain={[0, Math.ceil(maxPct / 5) * 5 + 5]}
                            tickFormatter={v => `${Math.round(Number(v))}%`}
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={45}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 100]}
                            ticks={[0, 20, 40, 60, 80, 100]}
                            tickFormatter={v => `${Math.round(Number(v))}%`}
                            tick={{ fill: '#f87171', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={45}
                          />
                          <Tooltip
                            contentStyle={{ ...tooltipStyle, padding: '10px 14px' }}
                            cursor={{ fill: 'rgba(99,102,241,0.04)' }}
                            formatter={(value: unknown, name: string) => {
                              if (name === 'pct') return [`${Number(value).toFixed(1)}%`, '% individual'];
                              if (name === 'cumul') return [`${Number(value).toFixed(1)}%`, '% acumulado'];
                              return [`${value}`, name];
                            }}
                            labelFormatter={(label: string) => label}
                          />
                          <ReferenceLine yAxisId="right" y={80} stroke="#6366f1" strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.6}>
                            <Label value="80%" position="left" fill="#6366f1" fontSize={10} fontWeight={600} offset={8} />
                          </ReferenceLine>
                          <ReferenceLine yAxisId="right" y={95} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5} strokeOpacity={0.6}>
                            <Label value="B/C" position="left" fill="#f59e0b" fontSize={10} fontWeight={600} offset={8} />
                          </ReferenceLine>
                          <Bar yAxisId="left" dataKey="pct" radius={[5, 5, 0, 0]} maxBarSize={48} animationDuration={800}>
                            {chartData.map((d, i) => <Cell key={i} fill={`url(#abcGrad${d.classe})`} />)}
                          </Bar>
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumul"
                            stroke="#ef4444"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: '#fff', stroke: '#ef4444', strokeWidth: 2.5 }}
                            activeDot={{ r: 6, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
                            animationDuration={1000}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-2 pt-3 border-t border-border/40">
                  <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                    <span className="inline-block w-3 h-3 rounded" style={{ background: 'linear-gradient(to bottom, #818cf8, #6366f1)' }} />
                    <span>% individual (barra)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                    <span className="inline-block w-4 h-0.5 rounded-full bg-red-500" />
                    <span className="inline-block w-2 h-2 rounded-full border-2 border-red-500 bg-white" />
                    <span>% acumulado (linha)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                    <span className="inline-block w-5 border-t-2 border-dashed border-indigo-400" />
                    <span>Limiar 80%</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                    <span className="inline-block w-5 border-t-2 border-dashed border-amber-400" />
                    <span>Limiar B/C</span>
                  </div>
                </div>
              </Card>
            );
            case 'ranking': return (
              <Card className="p-5 animate-fade-in-up" style={{ animationDelay: '345ms' }}>
                <div className="mb-4">
                  <h2 className="text-sm font-bold flex items-center gap-2">
                    Plano × Realizado por unidade · grupo
                    {selectedCategory !== 'Todas' && <Badge variant="secondary" className="text-primary bg-primary/12 border-primary/20 text-xs">{selectedCategory}</Badge>}
                    <HelpHint text="Compara, por grupo, o planejado e o realizado do mês corrente em cada unidade. A coluna % é realizado / planejado. A ordem dos grupos segue a Curva ABC da unidade Vitória (A = 80% do gasto · B = 15% · C = 5%)." />
                  </h2>
                  <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                    Mês corrente · ordem de grupos pela Curva ABC da unidade Vitória (80 / 15 / 5%)
                  </p>
                </div>
                {(() => {
                  const mesAtual = getMesAtualKey();
                  const normStr = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                  const getGrupoFromKey = (key: string): string | null => {
                    if (key.startsWith('G::')) return key.slice(3);
                    if (key.startsWith('SG::')) return key.slice(4).split('::')[0];
                    return null;
                  };

                  type Cell = { plan: number; real: number };
                  const dadosPorUnidade: Record<string, Record<string, Cell>> = {};

                  for (const u of unidades) {
                    const planByGrupo: Record<string, number> = {};
                    const catMapPlan = totaisAnuaisRaw[u.id]?.[mesAtual] ?? {};
                    for (const [cat, val] of Object.entries(catMapPlan)) {
                      const grupo = getGrupoFromKey(cat);
                      if (!grupo) continue;
                      if (selectedCategory !== 'Todas' && grupo !== selectedCategory) continue;
                      planByGrupo[grupo] = (planByGrupo[grupo] || 0) + val;
                    }
                    const realByGrupo: Record<string, number> = {};
                    const catMapReal = realizadoAnual[u.id]?.[mesAtual] ?? {};
                    for (const [cat, val] of Object.entries(catMapReal)) {
                      let grupo: string | null = null;
                      for (const [g, despesas] of Object.entries(despesasPorGrupo)) {
                        if ([...despesas].some(d => normStr(d) === normStr(cat))) { grupo = g; break; }
                      }
                      if (!grupo) continue;
                      if (selectedCategory !== 'Todas' && grupo !== selectedCategory) continue;
                      realByGrupo[grupo] = (realByGrupo[grupo] || 0) + val;
                    }
                    const allG = new Set([...Object.keys(planByGrupo), ...Object.keys(realByGrupo)]);
                    const cells: Record<string, Cell> = {};
                    for (const g of allG) cells[g] = { plan: planByGrupo[g] || 0, real: realByGrupo[g] || 0 };
                    dadosPorUnidade[u.id] = cells;
                  }

                  const refUnidade = unidades.find(u => normStr(u.nome).includes('vitoria')) ?? unidades[0];
                  if (!refUnidade) {
                    return <p className="text-sm text-muted-foreground text-center py-8">Sem unidades configuradas.</p>;
                  }
                  const cellsRef = dadosPorUnidade[refUnidade.id] ?? {};

                  const allGrupos = new Set<string>();
                  for (const cells of Object.values(dadosPorUnidade)) for (const g of Object.keys(cells)) allGrupos.add(g);

                  const grupoArr = [...allGrupos]
                    .map(g => ({ grupo: g, realRef: cellsRef[g]?.real ?? 0 }))
                    .filter(g => {
                      // mantém grupo se ao menos uma unidade tem plan ou real > 0
                      for (const u of unidades) {
                        const c = dadosPorUnidade[u.id]?.[g.grupo];
                        if (c && (c.plan > 0 || c.real > 0)) return true;
                      }
                      return false;
                    })
                    .sort((a, b) => b.realRef - a.realRef);

                  const totalRef = grupoArr.reduce((s, g) => s + g.realRef, 0);
                  let cumul = 0;
                  const grupos = grupoArr.map(g => {
                    const pct = totalRef > 0 ? (g.realRef / totalRef) * 100 : 0;
                    cumul += pct;
                    const classe: 'A' | 'B' | 'C' = cumul <= 80 ? 'A' : cumul <= 95 ? 'B' : 'C';
                    return { ...g, pct, cumul, classe };
                  });

                  const fmtK = (v: number) => {
                    const abs = Math.abs(v);
                    if (abs >= 1_000_000) return `R$${(abs / 1_000_000).toFixed(1)}M`;
                    if (abs >= 1_000) return `R$${(abs / 1_000).toFixed(1)}k`;
                    return `R$${abs.toFixed(0)}`;
                  };
                  const classeCor: Record<'A' | 'B' | 'C', string> = { A: '#6366f1', B: '#f59e0b', C: '#94a3b8' };

                  if (grupos.length === 0) {
                    return <p className="text-sm text-muted-foreground text-center py-8">Sem dados de planejamento × realizado para exibir.</p>;
                  }

                  return (
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full border-collapse text-xs tabular-nums">
                        <thead>
                          <tr className="text-[0.6rem] font-semibold text-muted-foreground uppercase tracking-widest">
                            <th rowSpan={2} className="text-left px-2 py-2 sticky left-0 bg-background border-b border-border/40 min-w-[170px]">Grupo</th>
                            {unidades.map(u => (
                              <th key={u.id} colSpan={3} className="text-center px-2 py-2 border-b border-border/40 border-l border-border/30">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full" style={{ background: u.cor }} />
                                  {u.nome}
                                </span>
                              </th>
                            ))}
                          </tr>
                          <tr className="text-[0.6rem] font-semibold text-muted-foreground uppercase tracking-widest">
                            {unidades.map(u => (
                              <React.Fragment key={u.id}>
                                <th className="text-right px-2 py-1 border-b border-border/40 border-l border-border/30">Planejado</th>
                                <th className="text-right px-2 py-1 border-b border-border/40">Realizado</th>
                                <th className="text-right px-2 py-1 border-b border-border/40">%</th>
                              </React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {grupos.map((g, idx) => (
                            <tr key={g.grupo} className={idx % 2 === 0 ? 'bg-muted/10' : ''}>
                              <td className="text-left px-2 py-1.5 sticky left-0 font-medium text-foreground" style={{ background: idx % 2 === 0 ? 'rgba(120,120,120,0.05)' : 'var(--background, #fff)' }} title={`${g.grupo} (Classe ${g.classe} · ${g.pct.toFixed(1)}% do gasto de ${refUnidade.nome})`}>
                                <span className="inline-flex items-center gap-2">
                                  <span className="inline-block w-5 text-center px-1 py-0.5 rounded text-[0.6rem] font-bold text-white" style={{ background: classeCor[g.classe] }}>{g.classe}</span>
                                  <span className="truncate max-w-[180px]">{g.grupo}</span>
                                </span>
                              </td>
                              {unidades.map(u => {
                                const cell = dadosPorUnidade[u.id]?.[g.grupo] ?? { plan: 0, real: 0 };
                                const pct = cell.plan > 0 ? (cell.real / cell.plan) * 100 : null;
                                const pctColor = pct === null ? '#94a3b8' : pct > 100 ? '#ef4444' : pct > 80 ? '#f59e0b' : '#059669';
                                return (
                                  <React.Fragment key={u.id}>
                                    <td className="text-right px-2 py-1.5 text-muted-foreground border-l border-border/30">{fmtK(cell.plan)}</td>
                                    <td className="text-right px-2 py-1.5 text-foreground font-semibold">{fmtK(cell.real)}</td>
                                    <td className="text-right px-2 py-1.5 font-bold" style={{ color: pctColor }}>
                                      {pct === null ? '—' : `${Math.round(pct)}%`}
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Legenda */}
                      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/40 text-[0.68rem] text-muted-foreground flex-wrap">
                        <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-white text-[0.6rem] font-bold" style={{ background: classeCor.A }}>A</span>~80% do gasto</span>
                        <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-white text-[0.6rem] font-bold" style={{ background: classeCor.B }}>B</span>~15%</span>
                        <span className="inline-flex items-center gap-1.5"><span className="px-1.5 py-0.5 rounded text-white text-[0.6rem] font-bold" style={{ background: classeCor.C }}>C</span>~5%</span>
                        <span>·</span>
                        <span>% = realizado / planejado</span>
                        <span>·</span>
                        <span>ordenação: <span className="font-medium text-foreground">{refUnidade.nome}</span></span>
                      </div>
                    </div>
                  );
                })()}
              </Card>
            );
            case 'desvio_categoria': {
              const normS = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
              const getGrupo = (key: string): string | null => {
                if (key.startsWith('G::')) return key.slice(3);
                if (key.startsWith('SG::')) return key.slice(4).split('::')[0];
                return null;
              };

              // Respeitar filtros: unidade, meses selecionados, categoria
              const unidadesFiltradas = activeUnidade ? [activeUnidade] : unidades;
              const mesesFiltro = mesesSelecionados.length > 0 ? mesesSelecionados : [getMesAtualKey()];

              const planPorCat: Record<string, number> = {};
              const realPorCat: Record<string, number> = {};

              for (const u of unidadesFiltradas) {
                for (const mes of mesesFiltro) {
                  // Planejado
                  const catMapPlan = totaisAnuaisRaw[u.id]?.[mes] ?? {};
                  for (const [cat, val] of Object.entries(catMapPlan)) {
                    const grupo = getGrupo(cat);
                    if (!grupo) continue;
                    if (selectedCategory !== 'Todas' && grupo !== selectedCategory) continue;
                    planPorCat[grupo] = (planPorCat[grupo] || 0) + val;
                  }
                  // Realizado
                  const catMapReal = realizadoAnual[u.id]?.[mes] ?? {};
                  for (const [cat, val] of Object.entries(catMapReal)) {
                    let grupo: string | null = null;
                    for (const [g, despesas] of Object.entries(despesasPorGrupo)) {
                      if ([...despesas].some(d => normS(d) === normS(cat))) { grupo = g; break; }
                    }
                    if (!grupo) continue;
                    if (selectedCategory !== 'Todas' && grupo !== selectedCategory) continue;
                    realPorCat[grupo] = (realPorCat[grupo] || 0) + val;
                  }
                }
              }

              const allCats = new Set([...Object.keys(planPorCat), ...Object.keys(realPorCat)]);
              const desvioItems = [...allCats]
                .map(cat => ({
                  name: cat.length > 22 ? cat.slice(0, 21) + '…' : cat,
                  fullName: cat,
                  plan: planPorCat[cat] || 0,
                  real: realPorCat[cat] || 0,
                  desvio: (realPorCat[cat] || 0) - (planPorCat[cat] || 0),
                }))
                .filter(d => d.plan > 0 || d.real > 0)
                .sort((a, b) => b.desvio - a.desvio);

              const maxAbs = Math.max(...desvioItems.map(d => Math.abs(d.desvio)), 1);
              const fmtK2 = (v: number) => {
                const abs = Math.abs(v);
                if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
                return v.toFixed(0);
              };

              return (
              <Card className="overflow-hidden border-0 shadow-md animate-fade-in-up" style={{ borderTop: `3px solid ${accentColor}`, animationDelay: '360ms' }}>
                <div className="p-4 pb-2">
                  <h2 className="text-sm font-bold mb-0.5 flex items-center gap-2">
                    Desvio por Categoria · Período Selecionado
                    {selectedCategory !== 'Todas' && <Badge variant="secondary" className="text-primary bg-primary/12 border-primary/20 text-xs">{selectedCategory}</Badge>}
                    <HelpHint text="Diferença (realizado − planejado) por grupo de despesa para o período filtrado. Barras vermelhas = acima do orçamento; verdes = abaixo. Útil para isolar em quais categorias houve maior estouro ou economia dentro da janela selecionada." />
                  </h2>
                  <p className="text-xs text-muted-foreground mb-2">Diferença entre realizado e planejado por grupo de despesa</p>
                  {(() => {
                    const totalPlan = desvioItems.reduce((s, d) => s + d.plan, 0);
                    const totalReal = desvioItems.reduce((s, d) => s + d.real, 0);
                    const resultado = totalReal - totalPlan;
                    const pctResultado = totalPlan > 0 ? (resultado / totalPlan) * 100 : 0;
                    const isOver = resultado > 0;
                    const corResultado = isOver ? '#dc2626' : '#16a34a';
                    const fmtR = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
                    return totalPlan > 0 || totalReal > 0 ? (
                      <div className="flex flex-wrap gap-4 mb-3 px-1 py-2 rounded-lg" style={{ background: `${accentColor}08` }}>
                        <div className="flex flex-col">
                          <span className="text-[0.58rem] font-semibold text-slate-400 uppercase tracking-wider">Planejado</span>
                          <span className="text-sm font-bold text-slate-500 tabular-nums">R$ {fmtR(totalPlan)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[0.58rem] font-semibold text-slate-400 uppercase tracking-wider">Realizado</span>
                          <span className="text-sm font-bold text-slate-700 tabular-nums">R$ {fmtR(totalReal)}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[0.58rem] font-semibold text-slate-400 uppercase tracking-wider">Resultado</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: corResultado }}>
                            {isOver ? '+' : ''}R$ {fmtR(resultado)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[0.58rem] font-semibold text-slate-400 uppercase tracking-wider">% Resultado</span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: corResultado }}>
                            {isOver ? '+' : ''}{pctResultado.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  {desvioItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Sem dados de planejamento × realizado para exibir.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {/* Header */}
                      <div className="flex items-center text-[0.6rem] font-bold text-slate-400 uppercase tracking-widest px-1 mb-1">
                        <div className="w-[160px] flex-shrink-0">Categoria</div>
                        <div className="flex-1" />
                        <div className="w-[80px] text-right">Planejado</div>
                        <div className="w-[80px] text-right">Realizado</div>
                        <div className="w-[80px] text-right">Desvio</div>
                      </div>
                      {desvioItems.map((item, idx) => {
                        const pct = (item.desvio / maxAbs) * 100;
                        const isOver = item.desvio > 0;
                        const barColor = isOver ? '#ef4444' : '#22c55e';
                        const barBg = isOver ? '#fef2f2' : '#f0fdf4';
                        return (
                          <div key={idx} className="flex items-center gap-1 px-1 py-1 rounded hover:bg-slate-50 transition-colors" style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <div className="w-[160px] flex-shrink-0 text-[0.7rem] font-semibold text-slate-700 truncate" title={item.fullName}>
                              {item.name}
                            </div>
                            {/* Barra de desvio */}
                            <div className="flex-1 flex items-center h-6 relative">
                              <div className="absolute inset-0 rounded" style={{ background: barBg }} />
                              {/* Centro (zero) */}
                              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
                              {/* Barra */}
                              {isOver ? (
                                <div className="absolute h-4 rounded-r top-1"
                                  style={{ left: '50%', width: `${Math.min(Math.abs(pct) / 2, 50)}%`, background: barColor, opacity: 0.75 }} />
                              ) : (
                                <div className="absolute h-4 rounded-l top-1"
                                  style={{ right: '50%', width: `${Math.min(Math.abs(pct) / 2, 50)}%`, background: barColor, opacity: 0.75 }} />
                              )}
                              {/* Label no centro da barra */}
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[0.58rem] font-bold" style={{ color: barColor }}>
                                  {isOver ? '+' : ''}{fmtK2(item.desvio)}
                                </span>
                              </div>
                            </div>
                            {/* Valores */}
                            <div className="w-[80px] text-right text-[0.65rem] tabular-nums text-slate-400 font-medium">
                              {fmtK2(item.plan)}
                            </div>
                            <div className="w-[80px] text-right text-[0.65rem] tabular-nums text-slate-600 font-semibold">
                              {fmtK2(item.real)}
                            </div>
                            <div className="w-[80px] text-right text-[0.68rem] tabular-nums font-bold" style={{ color: barColor }}>
                              {isOver ? '+' : ''}{new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(item.desvio)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
              );
            }
            case 'plan_vs_real': {
              const normPvr = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
              const getGrupoPvr = (key: string): string | null => {
                if (key.startsWith('G::')) return key.slice(3);
                if (key.startsWith('SG::')) return key.slice(4).split('::')[0];
                return null;
              };

              const unidadesFiltPvr = activeUnidade ? [activeUnidade] : unidades;
              const mesesFiltroPvr = mesesSelecionados.length > 0 ? mesesSelecionados : [getMesAtualKey()];

              // Agregar por categoria
              const pvrPlan: Record<string, number> = {};
              const pvrReal: Record<string, number> = {};

              for (const u of unidadesFiltPvr) {
                for (const mes of mesesFiltroPvr) {
                  const catMapP = totaisAnuaisRaw[u.id]?.[mes] ?? {};
                  for (const [cat, val] of Object.entries(catMapP)) {
                    const grupo = getGrupoPvr(cat);
                    if (!grupo) continue;
                    pvrPlan[grupo] = (pvrPlan[grupo] || 0) + val;
                  }
                  const catMapR = realizadoAnual[u.id]?.[mes] ?? {};
                  for (const [cat, val] of Object.entries(catMapR)) {
                    let grupo: string | null = null;
                    for (const [g, despesas] of Object.entries(despesasPorGrupo)) {
                      if ([...despesas].some(d => normPvr(d) === normPvr(cat))) { grupo = g; break; }
                    }
                    if (!grupo) continue;
                    pvrReal[grupo] = (pvrReal[grupo] || 0) + val;
                  }
                }
              }

              const allCatsPvr = [...new Set([...Object.keys(pvrPlan), ...Object.keys(pvrReal)])];
              const pvrData = allCatsPvr
                .map(cat => ({
                  categoria: cat.length > 18 ? cat.slice(0, 17) + '…' : cat,
                  planejado: pvrPlan[cat] || 0,
                  realizado: pvrReal[cat] || 0,
                }))
                .filter(d => d.planejado > 0 || d.realizado > 0)
                .sort((a, b) => Math.max(b.planejado, b.realizado) - Math.max(a.planejado, a.realizado));

              const totalPvr = pvrData.reduce((s, d) => s + d.planejado, 0);
              const totalRvr = pvrData.reduce((s, d) => s + d.realizado, 0);
              const resultadoPvr = totalRvr - totalPvr;
              const pctPvr = totalPvr > 0 ? (resultadoPvr / totalPvr) * 100 : 0;
              const isOverPvr = resultadoPvr > 0;

              const pvrChartConfig: ChartConfig = {
                planejado: { label: 'Planejado', color: 'hsl(215 70% 75%)' },
                realizado: { label: 'Realizado', color: 'hsl(215 80% 55%)' },
              };

              const fmtCompactPvr = (v: number) => {
                if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
                return v.toFixed(0);
              };

              return (
              <Card className="overflow-hidden border-0 shadow-md animate-fade-in-up" style={{ borderTop: `3px solid ${accentColor}`, animationDelay: '365ms' }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    Planejado vs Realizado por Categoria
                    {selectedCategory !== 'Todas' && <Badge variant="secondary" className="text-primary bg-primary/12 border-primary/20 text-xs">{selectedCategory}</Badge>}
                    <HelpHint text="Pares de barras por grupo: planejado (valor orçado) vs. realizado (pago) no período. Mesmos filtros de unidade/categoria aplicados ao restante do painel. Permite comparar se o gasto efetivo superou, igualou ou ficou abaixo do plano para cada grupo." />
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Comparativo de valores planejados e realizados por grupo de despesa · Período Selecionado
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {pvrData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Sem dados para exibir no período selecionado.</p>
                  ) : (
                    <ChartContainer config={pvrChartConfig} className="h-[200px] w-full">
                      <BarChart accessibilityLayer data={pvrData}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="categoria"
                          tickLine={false}
                          tickMargin={10}
                          axisLine={false}
                          tick={{ fontSize: 11 }}
                          interval={0}
                          tickFormatter={(value) => value.length > 12 ? value.slice(0, 11) + '…' : value}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              hideLabel
                              formatter={(value, name) => {
                                const label = name === 'planejado' ? 'Planejado' : 'Realizado';
                                return [`R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(Number(value))}`, label];
                              }}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar
                          dataKey="planejado"
                          stackId="a"
                          fill="var(--color-planejado)"
                          radius={[0, 0, 4, 4]}
                          maxBarSize={48}
                        >
                          <LabelList dataKey="planejado" position="center" formatter={(v: number) => v > 0 ? fmtCompactPvr(v) : ''} style={{ fill: '#fff', fontSize: '10px', fontWeight: 600 }} />
                        </Bar>
                        <Bar
                          dataKey="realizado"
                          stackId="a"
                          fill="var(--color-realizado)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={48}
                        >
                          <LabelList dataKey="realizado" position="center" formatter={(v: number) => v > 0 ? fmtCompactPvr(v) : ''} style={{ fill: '#fff', fontSize: '10px', fontWeight: 600 }} />
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
                {(totalPvr > 0 || totalRvr > 0) && (
                  <CardFooter className="flex-col items-start gap-2 text-sm border-t pt-4">
                    <div className="flex gap-2 leading-none font-medium" style={{ color: isOverPvr ? '#dc2626' : '#16a34a' }}>
                      {isOverPvr ? 'Acima do planejado em' : 'Abaixo do planejado em'} {Math.abs(pctPvr).toFixed(1)}%
                      {isOverPvr ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    </div>
                    <div className="leading-none text-muted-foreground text-xs">
                      Planejado: R$ {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(totalPvr)} · Realizado: R$ {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(totalRvr)}
                    </div>
                  </CardFooter>
                )}
              </Card>
              );
            }
            case 'categorias': return (
            <Card className="p-4 relative overflow-hidden animate-fade-in-up" style={{ animationDelay: '350ms' }}>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-1.5">Gastos por Categoria · Período Selecionado<HelpHint text="Ranking horizontal do gasto realizado por categoria/grupo contábil no período. Soma ValorPago (ou ValorParcela, quando não houver pagamento) respeitando todos os filtros ativos (unidade, categoria, situação, data)." /></h2>
              <div style={{ height: Math.max(300, categoryDataArray.length * 32) }}>
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
            );
            case 'detalhamento': return (
          <Card className="overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="flex justify-between items-center px-4 py-2.5 border-b border-border/50">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold">Detalhamento · Período Selecionado</h2>
                <HelpHint text="Lista paginada de todas as parcelas do CP que correspondem aos filtros ativos. Status por cor: verde = pago; vermelho = vencido e em aberto; âmbar = a pagar no futuro. A coluna Valor exibe ValorPago quando existir, caindo para ValorParcela caso contrário." />
              </div>
              <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/15 text-xs">{filteredData.length} registros</Badge>
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
                      <TableCell><Badge variant="category">{(() => {
                        const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                        const cat = item.Categoria || '';
                        for (const [g, despesas] of Object.entries(despesasPorGrupo)) {
                          if ([...despesas].some(d => norm(d) === norm(cat))) return g;
                        }
                        return cat;
                      })()}</Badge></TableCell>
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
            );
            default: return null;
          }
        };
        return (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
              {visibleIds.map(id => (
                <SortableSection key={id} id={id}>
                  {renderSection(id)}
                </SortableSection>
              ))}
            </SortableContext>
          </DndContext>
        );
      })()}

      {/* Heat map tooltip */}
      {heatTooltip && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: heatTooltip.x + 14, top: heatTooltip.y - 10 }}
        >
          <div className="bg-popover border border-border rounded-xl shadow-2xl px-3.5 py-2.5 text-xs min-w-[170px]">
            <div className="font-bold text-foreground mb-1.5">{heatTooltip.unidade} · {heatTooltip.mes}</div>
            <div className="flex justify-between gap-4 mb-0.5">
              <span className="text-muted-foreground">Realizado</span>
              <span className="font-semibold text-foreground">R$ {fmtBRL(heatTooltip.real)}</span>
            </div>
            <div className="flex justify-between gap-4 mb-1.5">
              <span className="text-muted-foreground">Planejado</span>
              <span className="font-semibold text-foreground">R$ {fmtBRL(heatTooltip.plan)}</span>
            </div>
            <div className="border-t border-border/50 pt-1.5 flex justify-between gap-4">
              <span className="text-muted-foreground">Desvio</span>
              <span className={`font-bold ${heatTooltip.desvio > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                {heatTooltip.desvio > 0 ? '+' : ''}{heatTooltip.desvio.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
