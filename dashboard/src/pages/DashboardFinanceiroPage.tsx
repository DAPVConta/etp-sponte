import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, LabelList, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle, Clock, Users, BarChart3,
  Percent, RefreshCw, AlertCircle,
} from 'lucide-react';
import type { Unidade } from '../types';
import { supabase } from '../lib/supabase';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ── Tipos internos ───────────────────────────────────────────────────────────
interface LinhaCP {
  unidade_id: string;
  vencimento: string | null;       // YYYY-MM-DD
  data_pagamento: string | null;   // YYYY-MM-DD
  valor_parcela: number;
  valor_pago: number;
  situacao_parcela: string;
  categoria: string;
  sacado: string;
}
interface LinhaCR extends LinhaCP {
  aluno_id: number | null;
}

interface Props {
  activeUnidade: Unidade | null;
  unidades: Unidade[];
  accentColor: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCompact = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
};

const MONTH_NAMES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(`${d}T00:00:00`) : d;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
};

const hojeZero = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

const isRecebidaCR = (r: LinhaCR) =>
  !!r.data_pagamento && !!r.situacao_parcela && r.situacao_parcela !== 'A Receber'
  && !r.situacao_parcela.toLowerCase().includes('cancel');

const isPagaCP = (r: LinhaCP) =>
  !!r.data_pagamento && !!r.situacao_parcela && r.situacao_parcela !== 'Pendente'
  && !r.situacao_parcela.toLowerCase().includes('cancel');

const isCancelada = (r: { situacao_parcela: string }) =>
  (r.situacao_parcela || '').toLowerCase().includes('cancel');

// Valor efetivo: prefere valor_pago quando > 0, senao valor_parcela
const valorRealizado = (r: LinhaCP) => r.valor_pago > 0 ? r.valor_pago : r.valor_parcela;

// Fetch paginado com intervalo de datas — vencimento OU data_pagamento dentro
async function fetchRange<T>(table: string, unidadeIds: string[], startStr: string, endStr: string, columns: string): Promise<T[]> {
  if (!unidadeIds.length) return [];
  let all: T[] = [];
  let page = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in('unidade_id', unidadeIds)
      .or(`vencimento.gte.${startStr},data_pagamento.gte.${startStr}`)
      .or(`vencimento.lte.${endStr},data_pagamento.lte.${endStr}`)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data as unknown as T[]);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
}

// ── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({
  title, value, icon: Icon, delta, deltaLabel, tone, sub,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  delta?: number | null;
  deltaLabel?: string;
  tone?: 'positive' | 'negative' | 'neutral' | 'warning';
  sub?: string;
}) {
  const toneBg =
    tone === 'positive' ? 'bg-emerald-500/10 text-emerald-600' :
    tone === 'negative' ? 'bg-rose-500/10 text-rose-600'       :
    tone === 'warning'  ? 'bg-amber-500/10 text-amber-600'     :
                          'bg-slate-500/10 text-slate-600';

  const deltaTone =
    delta == null      ? 'text-muted-foreground'                :
    delta > 0          ? 'text-emerald-600'                     :
    delta < 0          ? 'text-rose-600'                        :
                         'text-muted-foreground';

  const DeltaIcon = delta == null ? null : delta >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{title}</p>
          <p className="text-2xl font-semibold mt-1 truncate">{value}</p>
          {sub && <p className="text-[0.7rem] text-muted-foreground mt-0.5 truncate">{sub}</p>}
        </div>
        <div className={cn('p-2 rounded-lg flex-shrink-0', toneBg)}>
          <Icon size={18} />
        </div>
      </div>
      {delta != null && DeltaIcon && (
        <div className={cn('flex items-center gap-1 text-xs mt-3', deltaTone)}>
          <DeltaIcon size={12} />
          <span className="font-medium">{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span>
          {deltaLabel && <span className="text-muted-foreground ml-1">{deltaLabel}</span>}
        </div>
      )}
    </Card>
  );
}

// ── Componente ───────────────────────────────────────────────────────────────
export default function DashboardFinanceiroPage({ activeUnidade, unidades, accentColor }: Props) {
  const [cp, setCp] = useState<LinhaCP[]>([]);
  const [cr, setCr] = useState<LinhaCR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Unidade scope: se ha activeUnidade, so essa; senao todas
  const unidadeIds = useMemo(
    () => activeUnidade ? [activeUnidade.id] : unidades.map(u => u.id),
    [activeUnidade, unidades]
  );

  const carregar = async () => {
    if (!unidadeIds.length) return;
    setLoading(true);
    setError('');
    try {
      const hoje = hojeZero();
      const start = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
      const end   = new Date(hoje.getFullYear(), hoje.getMonth() + 4, 0); // ~90 dias a frente
      const startStr = ymd(start);
      const endStr   = ymd(end);

      const [cpRows, crRows] = await Promise.all([
        fetchRange<LinhaCP>(
          'etp_contas_pagar',
          unidadeIds,
          startStr,
          endStr,
          'unidade_id, vencimento, data_pagamento, valor_parcela, valor_pago, situacao_parcela, categoria, sacado'
        ),
        fetchRange<LinhaCR>(
          'etp_contas_receber',
          unidadeIds,
          startStr,
          endStr,
          'unidade_id, vencimento, data_pagamento, valor_parcela, valor_pago, situacao_parcela, categoria, sacado, aluno_id'
        ),
      ]);
      setCp(cpRows);
      setCr(crRows);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [unidadeIds.join(',')]);

  // ── Derivações ───────────────────────────────────────────────────────────
  const mesAtualKey = useMemo(() => ym(hojeZero()), []);
  const mesAnteriorKey = useMemo(() => {
    const d = hojeZero();
    d.setMonth(d.getMonth() - 1);
    return ym(d);
  }, []);

  // KPIs do mês atual
  const kpis = useMemo(() => {
    const hoje = hojeZero();

    // Realizados (data_pagamento no mes)
    let recebidoMes = 0, recebidoMesAnt = 0;
    let pagoMes = 0, pagoMesAnt = 0;
    const sacadosMes = new Set<string>();

    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (k === mesAtualKey)    { recebidoMes    += valorRealizado(r); if (r.aluno_id != null) sacadosMes.add(String(r.aluno_id)); else if (r.sacado) sacadosMes.add(r.sacado); }
      if (k === mesAnteriorKey) { recebidoMesAnt += valorRealizado(r); }
    }
    for (const r of cp) {
      if (!isPagaCP(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (k === mesAtualKey)    pagoMes    += valorRealizado(r);
      if (k === mesAnteriorKey) pagoMesAnt += valorRealizado(r);
    }

    const resultadoMes    = recebidoMes    - pagoMes;
    const resultadoMesAnt = recebidoMesAnt - pagoMesAnt;
    const deltaResultado  = resultadoMesAnt !== 0 ? ((resultadoMes - resultadoMesAnt) / Math.abs(resultadoMesAnt)) * 100 : null;

    // Previsto (vencimento no mes, sem pagamento)
    let previstoReceber = 0;
    let previstoPagar = 0;
    for (const r of cr) {
      if (!r.vencimento || isCancelada(r)) continue;
      if (ym(r.vencimento) !== mesAtualKey) continue;
      previstoReceber += r.valor_parcela;
    }
    for (const r of cp) {
      if (!r.vencimento || isCancelada(r)) continue;
      if (ym(r.vencimento) !== mesAtualKey) continue;
      previstoPagar += r.valor_parcela;
    }
    const resultadoPrevisto = previstoReceber - previstoPagar;

    // Margem
    const margem = recebidoMes > 0 ? (resultadoMes / recebidoMes) * 100 : 0;
    const margemAnt = recebidoMesAnt > 0 ? (resultadoMesAnt / recebidoMesAnt) * 100 : 0;
    const deltaMargem = recebidoMesAnt > 0 ? (margem - margemAnt) : null;

    // Inadimplência CR: vencido, nao recebido, nao cancelado
    let inadimpCR = 0;
    for (const r of cr) {
      if (isRecebidaCR(r) || isCancelada(r) || !r.vencimento) continue;
      const v = new Date(`${r.vencimento}T00:00:00`);
      if (v < hoje) inadimpCR += r.valor_parcela;
    }

    // CP em atraso
    let atrasoCP = 0;
    for (const r of cp) {
      if (isPagaCP(r) || isCancelada(r) || !r.vencimento) continue;
      const v = new Date(`${r.vencimento}T00:00:00`);
      if (v < hoje) atrasoCP += r.valor_parcela;
    }

    // Ticket médio: recebido no mes / nº sacados (alunos) distintos
    const ticketMedio = sacadosMes.size > 0 ? recebidoMes / sacadosMes.size : 0;

    return {
      resultadoMes,
      deltaResultado,
      recebidoMes,
      pagoMes,
      resultadoPrevisto,
      previstoReceber,
      previstoPagar,
      margem,
      deltaMargem,
      inadimpCR,
      atrasoCP,
      ticketMedio,
      sacadosMes: sacadosMes.size,
    };
  }, [cp, cr, mesAtualKey, mesAnteriorKey]);

  // Fluxo de Caixa 12m — bars CR/CP + linha saldo acumulado
  const fluxo12m = useMemo(() => {
    const base = hojeZero();
    const meses: { key: string; ano: number; mes: number; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      meses.push({
        key: ym(d),
        ano: d.getFullYear(),
        mes: d.getMonth(),
        label: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
      });
    }
    const receitaPorMes: Record<string, number> = {};
    const despesaPorMes: Record<string, number> = {};
    meses.forEach(m => { receitaPorMes[m.key] = 0; despesaPorMes[m.key] = 0; });
    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (k in receitaPorMes) receitaPorMes[k] += valorRealizado(r);
    }
    for (const r of cp) {
      if (!isPagaCP(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (k in despesaPorMes) despesaPorMes[k] += valorRealizado(r);
    }
    let acum = 0;
    return meses.map(m => {
      const receita = receitaPorMes[m.key] || 0;
      const despesa = despesaPorMes[m.key] || 0;
      const saldo = receita - despesa;
      acum += saldo;
      return {
        mes: m.label,
        receita,
        despesa: -despesa,       // negativo p/ empilhar abaixo do zero
        saldo,
        acumulado: acum,
      };
    });
  }, [cp, cr]);

  // Previsto x Realizado (12m)
  const prevReal12m = useMemo(() => {
    const base = hojeZero();
    const meses: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      meses.push({ key: ym(d), label: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` });
    }
    const init = () => meses.reduce((a, m) => ({ ...a, [m.key]: 0 }), {} as Record<string, number>);
    const prevCR = init(), realCR = init(), prevCP = init(), realCP = init();

    for (const r of cr) {
      if (!isCancelada(r) && r.vencimento) {
        const k = ym(r.vencimento);
        if (k in prevCR) prevCR[k] += r.valor_parcela;
      }
      if (isRecebidaCR(r) && r.data_pagamento) {
        const k = ym(r.data_pagamento);
        if (k in realCR) realCR[k] += valorRealizado(r);
      }
    }
    for (const r of cp) {
      if (!isCancelada(r) && r.vencimento) {
        const k = ym(r.vencimento);
        if (k in prevCP) prevCP[k] += r.valor_parcela;
      }
      if (isPagaCP(r) && r.data_pagamento) {
        const k = ym(r.data_pagamento);
        if (k in realCP) realCP[k] += valorRealizado(r);
      }
    }
    return meses.map(m => ({
      mes: m.label,
      previstoCR: prevCR[m.key],
      realizadoCR: realCR[m.key],
      previstoCP: prevCP[m.key],
      realizadoCP: realCP[m.key],
    }));
  }, [cp, cr]);

  // Aging CP proximos 90 dias (0-30, 31-60, 61-90)
  const agingCP = useMemo(() => {
    const hoje = hojeZero();
    const buckets = [
      { key: '0-30',  label: '0-30 dias',  min: 0,  max: 30,  total: 0, atraso: 0 },
      { key: '31-60', label: '31-60 dias', min: 31, max: 60,  total: 0, atraso: 0 },
      { key: '61-90', label: '61-90 dias', min: 61, max: 90,  total: 0, atraso: 0 },
    ];
    for (const r of cp) {
      if (isPagaCP(r) || isCancelada(r) || !r.vencimento) continue;
      const v = new Date(`${r.vencimento}T00:00:00`);
      const diff = Math.floor((v.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      if (diff < -90 || diff > 90) continue;
      if (diff < 0) {
        // Atrasado
        const absd = -diff;
        const b = buckets.find(b => absd >= b.min && absd <= b.max);
        if (b) b.atraso += r.valor_parcela;
      } else {
        const b = buckets.find(b => diff >= b.min && diff <= b.max);
        if (b) b.total += r.valor_parcela;
      }
    }
    return buckets;
  }, [cp]);

  // Comparativo entre Unidades (mes atual)
  const comparativoUnidades = useMemo(() => {
    const porUid: Record<string, { receita: number; despesa: number }> = {};
    for (const u of unidades) porUid[u.id] = { receita: 0, despesa: 0 };
    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      if (ym(r.data_pagamento) !== mesAtualKey) continue;
      if (!porUid[r.unidade_id]) porUid[r.unidade_id] = { receita: 0, despesa: 0 };
      porUid[r.unidade_id].receita += valorRealizado(r);
    }
    for (const r of cp) {
      if (!isPagaCP(r) || !r.data_pagamento) continue;
      if (ym(r.data_pagamento) !== mesAtualKey) continue;
      if (!porUid[r.unidade_id]) porUid[r.unidade_id] = { receita: 0, despesa: 0 };
      porUid[r.unidade_id].despesa += valorRealizado(r);
    }
    return unidades
      .map(u => ({
        nome: u.nome,
        cor: u.cor,
        receita: porUid[u.id]?.receita || 0,
        despesa: porUid[u.id]?.despesa || 0,
        resultado: (porUid[u.id]?.receita || 0) - (porUid[u.id]?.despesa || 0),
      }))
      .filter(u => u.receita > 0 || u.despesa > 0)
      .sort((a, b) => b.resultado - a.resultado);
  }, [cp, cr, unidades, mesAtualKey]);

  // Top 20 Inadimplentes CR — agrupa por sacado (ou aluno_id)
  const topInadimplentes = useMemo(() => {
    const hoje = hojeZero();
    const porSacado: Record<string, {
      sacado: string;
      unidade: string;
      valor: number;
      parcelas: number;
      maxDias: number;
    }> = {};

    for (const r of cr) {
      if (isRecebidaCR(r) || isCancelada(r) || !r.vencimento) continue;
      const venc = new Date(`${r.vencimento}T00:00:00`);
      if (venc >= hoje) continue;
      const dias = Math.floor((hoje.getTime() - venc.getTime()) / 86400000);
      const chave = r.aluno_id != null ? `a:${r.aluno_id}` : `s:${r.sacado || 'Sem sacado'}`;
      const unidade = unidades.find(u => u.id === r.unidade_id)?.nome || '—';

      if (!porSacado[chave]) {
        porSacado[chave] = {
          sacado: r.sacado || (r.aluno_id != null ? `Aluno ${r.aluno_id}` : 'Sem sacado'),
          unidade,
          valor: 0,
          parcelas: 0,
          maxDias: 0,
        };
      }
      porSacado[chave].valor    += r.valor_parcela;
      porSacado[chave].parcelas += 1;
      if (dias > porSacado[chave].maxDias) porSacado[chave].maxDias = dias;
    }

    return Object.values(porSacado)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 20);
  }, [cr, unidades]);

  // Top 20 compromissos CP a vencer nos próximos 30 dias
  const topCompromissosCP = useMemo(() => {
    const hoje = hojeZero();
    const limite = new Date(hoje); limite.setDate(limite.getDate() + 30);

    return cp
      .filter(r => {
        if (isPagaCP(r) || isCancelada(r) || !r.vencimento) return false;
        const v = new Date(`${r.vencimento}T00:00:00`);
        return v >= hoje && v <= limite;
      })
      .map(r => ({
        sacado:    r.sacado || 'Sem fornecedor',
        categoria: r.categoria || '—',
        unidade:   unidades.find(u => u.id === r.unidade_id)?.nome || '—',
        vencimento: r.vencimento!,
        valor: r.valor_parcela,
      }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .slice(0, 20);
  }, [cp, unidades]);

  // Margem por unidade × mês (últimos 6 meses) — heatmap
  const margemMatriz = useMemo(() => {
    const base = hojeZero();
    const meses: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      meses.push({ key: ym(d), label: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` });
    }

    // { uid: { mesKey: { receita, despesa } } }
    const dados: Record<string, Record<string, { receita: number; despesa: number }>> = {};
    for (const u of unidades) {
      dados[u.id] = {};
      meses.forEach(m => { dados[u.id][m.key] = { receita: 0, despesa: 0 }; });
    }

    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (dados[r.unidade_id]?.[k]) dados[r.unidade_id][k].receita += valorRealizado(r);
    }
    for (const r of cp) {
      if (!isPagaCP(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (dados[r.unidade_id]?.[k]) dados[r.unidade_id][k].despesa += valorRealizado(r);
    }

    const linhas = unidades
      .map(u => ({
        nome: u.nome,
        celulas: meses.map(m => {
          const { receita, despesa } = dados[u.id][m.key];
          const resultado = receita - despesa;
          const margem = receita > 0 ? (resultado / receita) * 100 : null;
          return { mesKey: m.key, receita, despesa, resultado, margem };
        }),
      }))
      .filter(l => l.celulas.some(c => c.receita > 0 || c.despesa > 0));

    return { meses, linhas };
  }, [cp, cr, unidades]);

  // Cor por % margem (heatmap)
  const margemBg = (m: number | null): string => {
    if (m == null) return 'transparent';
    if (m >= 30) return 'rgba(16, 185, 129, 0.30)';   // emerald forte
    if (m >= 15) return 'rgba(16, 185, 129, 0.18)';
    if (m >= 5)  return 'rgba(16, 185, 129, 0.08)';
    if (m >= 0)  return 'rgba(148, 163, 184, 0.10)';  // neutro
    if (m >= -10) return 'rgba(239, 68, 68, 0.12)';
    if (m >= -25) return 'rgba(239, 68, 68, 0.25)';
    return 'rgba(239, 68, 68, 0.40)';                  // vermelho forte
  };

  const fmtDatePtBR = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const sub = activeUnidade?.nome || `${unidades.length} unidade${unidades.length !== 1 ? 's' : ''}`;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 size={22} style={{ color: accentColor }} />
            Dashboard Financeiro
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visão estratégica — {sub}
          </p>
        </div>
        <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
          <RefreshCw size={14} className={cn('mr-1.5', loading && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-red-700 text-sm">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          title="Resultado do mês"
          value={`R$ ${fmtBRL(kpis.resultadoMes)}`}
          icon={Wallet}
          tone={kpis.resultadoMes >= 0 ? 'positive' : 'negative'}
          delta={kpis.deltaResultado}
          deltaLabel="vs. mês anterior"
          sub={`Receb. R$ ${fmtCompact(kpis.recebidoMes)} − Pago R$ ${fmtCompact(kpis.pagoMes)}`}
        />
        <KpiCard
          title="Resultado previsto"
          value={`R$ ${fmtBRL(kpis.resultadoPrevisto)}`}
          icon={TrendingUp}
          tone={kpis.resultadoPrevisto >= 0 ? 'positive' : 'negative'}
          sub={`Rec. R$ ${fmtCompact(kpis.previstoReceber)} − Desp. R$ ${fmtCompact(kpis.previstoPagar)}`}
        />
        <KpiCard
          title="Margem operacional"
          value={`${kpis.margem.toFixed(1)}%`}
          icon={Percent}
          tone={kpis.margem >= 0 ? 'positive' : 'negative'}
          delta={kpis.deltaMargem}
          deltaLabel="pp vs. mês anterior"
        />
        <KpiCard
          title="Inadimplência CR"
          value={`R$ ${fmtBRL(kpis.inadimpCR)}`}
          icon={AlertTriangle}
          tone="warning"
          sub="Vencido não recebido"
        />
        <KpiCard
          title="CP em atraso"
          value={`R$ ${fmtBRL(kpis.atrasoCP)}`}
          icon={Clock}
          tone="warning"
          sub="Vencido não pago"
        />
        <KpiCard
          title="Ticket médio"
          value={`R$ ${fmtBRL(kpis.ticketMedio)}`}
          icon={Users}
          tone="neutral"
          sub={`${kpis.sacadosMes} sacado${kpis.sacadosMes !== 1 ? 's' : ''} no mês`}
        />
      </div>

      {/* Gráfico 1 — Fluxo de Caixa 12m */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Fluxo de Caixa — últimos 12 meses</h2>
          <p className="text-xs text-muted-foreground">Receita × Despesa + saldo acumulado</p>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={fluxo12m} stackOffset="sign" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `R$ ${fmtBRL(Math.abs(v))}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="receita"  name="Receita"  stackId="f" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesa"  name="Despesa"  stackId="f" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="acumulado" name="Saldo acumulado" stroke={accentColor} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Gráfico 2 — Previsto x Realizado */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Previsto × Realizado — 12 meses</h2>
          <p className="text-xs text-muted-foreground">CR (verde) e CP (vermelho), barras claras = previsto</p>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={prevReal12m} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `R$ ${fmtBRL(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="previstoCR"  name="Prev. CR"  fill="#6ee7b7" radius={[3, 3, 0, 0]} />
              <Bar dataKey="realizadoCR" name="Real. CR"  fill="#059669" radius={[3, 3, 0, 0]} />
              <Bar dataKey="previstoCP"  name="Prev. CP"  fill="#fca5a5" radius={[3, 3, 0, 0]} />
              <Bar dataKey="realizadoCP" name="Real. CP"  fill="#dc2626" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Gráficos 3 e 4 lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Aging — CP próximos 90 dias</h2>
            <p className="text-xs text-muted-foreground">Por faixa de vencimento</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingCP} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `R$ ${fmtBRL(v)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="atraso" name="Em atraso" stackId="a" fill="#dc2626" radius={[0, 0, 0, 0]}>
                  <LabelList dataKey="atraso" position="inside" formatter={(v: number) => v > 0 ? fmtCompact(v) : ''} style={{ fill: '#fff', fontSize: 10 }} />
                </Bar>
                <Bar dataKey="total"  name="A vencer"  stackId="a" fill="#f59e0b" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="total" position="top" formatter={(v: number) => v > 0 ? `R$ ${fmtCompact(v)}` : ''} style={{ fontSize: 10 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Comparativo entre Unidades — mês atual</h2>
            <p className="text-xs text-muted-foreground">Resultado ordenado</p>
          </div>
          <div className="h-64">
            {comparativoUnidades.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Sem dados do mês para comparar.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparativoUnidades} layout="vertical" margin={{ top: 8, right: 40, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="nome" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `R$ ${fmtBRL(v)}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="receita"   name="Receita"   fill="#10b981" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="despesa"   name="Despesa"   fill="#ef4444" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="resultado" name="Resultado" radius={[0, 3, 3, 0]}>
                    {comparativoUnidades.map((u, i) => (
                      <Cell key={i} fill={u.resultado >= 0 ? '#3b82f6' : '#b91c1c'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Tabela 1 — Top 20 Inadimplentes CR */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Top 20 Inadimplentes — Contas a Receber</h2>
          <p className="text-xs text-muted-foreground">Vencido e não recebido</p>
        </div>
        {topInadimplentes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Sem inadimplência no momento.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-xs">#</TableHead>
                  <TableHead className="text-xs">Sacado</TableHead>
                  <TableHead className="text-xs">Unidade</TableHead>
                  <TableHead className="text-xs text-center">Parcelas</TableHead>
                  <TableHead className="text-xs text-center">Dias em atraso</TableHead>
                  <TableHead className="text-xs text-right">Valor total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topInadimplentes.map((row, i) => (
                  <TableRow key={`${row.sacado}-${i}`}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs font-medium">{row.sacado}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.unidade}</TableCell>
                    <TableCell className="text-xs text-center">{row.parcelas}</TableCell>
                    <TableCell className="text-xs text-center">
                      <span className={cn(
                        'px-1.5 py-0.5 rounded font-medium',
                        row.maxDias > 60 ? 'bg-red-100 text-red-700' :
                        row.maxDias > 30 ? 'bg-amber-100 text-amber-700' :
                                            'bg-slate-100 text-slate-700'
                      )}>
                        {row.maxDias}d
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right font-semibold tabular-nums">R$ {fmtBRL(row.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Tabela 2 — Top 20 Compromissos CP próximos 30 dias */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Compromissos CP — próximos 30 dias</h2>
          <p className="text-xs text-muted-foreground">Ordenado por vencimento</p>
        </div>
        {topCompromissosCP.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhum compromisso nos próximos 30 dias.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-xs">#</TableHead>
                  <TableHead className="text-xs">Vencimento</TableHead>
                  <TableHead className="text-xs">Fornecedor</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs">Unidade</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCompromissosCP.map((row, i) => (
                  <TableRow key={`${row.sacado}-${row.vencimento}-${i}`}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs tabular-nums">{fmtDatePtBR(row.vencimento)}</TableCell>
                    <TableCell className="text-xs font-medium">{row.sacado}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.categoria}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.unidade}</TableCell>
                    <TableCell className="text-xs text-right font-semibold tabular-nums">R$ {fmtBRL(row.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Tabela 3 — Margem por unidade × mês (heatmap) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Margem operacional por Unidade × Mês</h2>
          <p className="text-xs text-muted-foreground">Últimos 6 meses — verde = positiva, vermelho = negativa</p>
        </div>
        {margemMatriz.linhas.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Sem dados suficientes nos últimos 6 meses.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs sticky left-0 bg-background">Unidade</TableHead>
                  {margemMatriz.meses.map(m => (
                    <TableHead key={m.key} className="text-xs text-center min-w-[88px]">{m.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {margemMatriz.linhas.map(linha => (
                  <TableRow key={linha.nome}>
                    <TableCell className="text-xs font-medium sticky left-0 bg-background">{linha.nome}</TableCell>
                    {linha.celulas.map(c => (
                      <TableCell
                        key={c.mesKey}
                        className="text-xs text-center tabular-nums p-1"
                        style={{ backgroundColor: margemBg(c.margem) }}
                        title={`Receita R$ ${fmtBRL(c.receita)} · Despesa R$ ${fmtBRL(c.despesa)} · Resultado R$ ${fmtBRL(c.resultado)}`}
                      >
                        {c.margem == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn('font-medium', c.margem < 0 && 'text-rose-700')}>
                            {c.margem.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <RefreshCw size={14} className="animate-spin mr-2" /> Carregando…
        </div>
      )}
    </div>
  );
}
