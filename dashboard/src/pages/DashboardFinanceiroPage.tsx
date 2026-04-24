import { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, LabelList, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, Wallet, Users,
  Percent, RefreshCw, AlertCircle, Wifi, CalendarDays, ChevronDown, Info,
} from 'lucide-react';
import type { Unidade } from '../types';
import { supabase } from '../lib/supabase';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HelpHint } from '@/components/HelpHint';

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

// Mes anterior ao corrente (ultimo mes fechado)
const getMesRefDefault = (): string => {
  const d = hojeZero();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return ym(d);
};

// Constroi lista de meses (YYYY-MM) terminando em mesRef e voltando N meses
const mesesAte = (mesRef: string, n: number): { key: string; mes: number; ano: number; label: string }[] => {
  const [anoR, mR] = mesRef.split('-').map(Number);
  const base = new Date(anoR, mR - 1, 1);
  const arr: { key: string; mes: number; ano: number; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    arr.push({
      key: ym(d),
      mes: d.getMonth(),
      ano: d.getFullYear(),
      label: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
    });
  }
  return arr;
};

// Gera lista de meses disponiveis no filtro (ultimos 24 meses, excluindo mes corrente)
const mesesDisponiveis = (): { value: string; label: string }[] => {
  const d = hojeZero();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);                 // comeca no mes anterior
  const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const arr: { value: string; label: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    arr.push({ value: ym(dd), label: `${MESES_FULL[dd.getMonth()]} ${dd.getFullYear()}` });
  }
  return arr;
};

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


// ── Componente ───────────────────────────────────────────────────────────────
export default function DashboardFinanceiroPage({ activeUnidade, unidades, accentColor }: Props) {
  const [cp, setCp] = useState<LinhaCP[]>([]);
  const [cr, setCr] = useState<LinhaCR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mes de referencia (ultimo fechado). Default = mes anterior.
  const [mesRef, setMesRef] = useState<string>(getMesRefDefault);
  const [showMesDropdown, setShowMesDropdown] = useState(false);
  const mesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMesDropdown) return;
    const close = (e: MouseEvent) => {
      if (mesContainerRef.current && !mesContainerRef.current.contains(e.target as Node)) {
        setShowMesDropdown(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMesDropdown]);

  const mesesLista = useMemo(() => mesesDisponiveis(), []);
  const mesRefLabel = mesesLista.find(m => m.value === mesRef)?.label || mesRef;

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
  // mesAtualKey = mes de referencia (ultimo fechado)
  // mesAnteriorKey = mes imediatamente anterior ao de referencia
  const mesAtualKey = mesRef;
  const mesAnteriorKey = useMemo(() => {
    const [ano, m] = mesRef.split('-').map(Number);
    const d = new Date(ano, m - 2, 1);
    return ym(d);
  }, [mesRef]);

  // KPIs
  const kpis = useMemo(() => {
    // --- Realizados do mes de referencia vs mes anterior ---
    let recebidoMes = 0, recebidoMesAnt = 0;
    let pagoMes = 0, pagoMesAnt = 0;

    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (k === mesAtualKey)    recebidoMes    += valorRealizado(r);
      if (k === mesAnteriorKey) recebidoMesAnt += valorRealizado(r);
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

    // --- Previsto (vencimento no mes, sem pagamento) ---
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

    // --- Agregados 12 meses (ate mesRef) — ticket medio e margem ---
    const meses12 = mesesAte(mesAtualKey, 12);
    const meses12Set = new Set(meses12.map(m => m.key));
    const receita12: Record<string, number> = {};
    const despesa12: Record<string, number> = {};
    meses12.forEach(m => { receita12[m.key] = 0; despesa12[m.key] = 0; });

    let recebido12m = 0;
    const sacados12m = new Set<string>();
    for (const r of cr) {
      if (!isRecebidaCR(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (!meses12Set.has(k)) continue;
      const v = valorRealizado(r);
      receita12[k] += v;
      recebido12m += v;
      if (r.aluno_id != null) sacados12m.add(`a:${r.aluno_id}`);
      else if (r.sacado)      sacados12m.add(`s:${r.sacado}`);
    }
    for (const r of cp) {
      if (!isPagaCP(r) || !r.data_pagamento) continue;
      const k = ym(r.data_pagamento);
      if (!meses12Set.has(k)) continue;
      despesa12[k] += valorRealizado(r);
    }

    // Margem operacional = media simples das margens mensais (meses com receita > 0)
    const margensMensais: number[] = [];
    for (const m of meses12) {
      const rec = receita12[m.key];
      if (rec > 0) {
        margensMensais.push(((rec - despesa12[m.key]) / rec) * 100);
      }
    }
    const margem12m = margensMensais.length
      ? margensMensais.reduce((a, b) => a + b, 0) / margensMensais.length
      : 0;

    const ticketMedio12m = sacados12m.size > 0 ? recebido12m / sacados12m.size : 0;

    return {
      resultadoMes,
      deltaResultado,
      recebidoMes,
      pagoMes,
      resultadoPrevisto,
      previstoReceber,
      previstoPagar,
      margem12m,
      margemMesesValidos: margensMensais.length,
      ticketMedio12m,
      sacados12m: sacados12m.size,
      recebido12m,
    };
  }, [cp, cr, mesAtualKey, mesAnteriorKey]);

  // Fluxo de Caixa 12m — bars CR/CP + linha saldo acumulado (termina em mesRef)
  const fluxo12m = useMemo(() => {
    const meses = mesesAte(mesRef, 12);
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
  }, [cp, cr, mesRef]);

  // Previsto x Realizado (12m terminando em mesRef)
  const prevReal12m = useMemo(() => {
    const meses = mesesAte(mesRef, 12);
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
  }, [cp, cr, mesRef]);

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

  // Margem por unidade × mês (6 meses terminando em mesRef) — com totais + média
  const margemMatriz = useMemo(() => {
    const meses = mesesAte(mesRef, 6);

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

    // Media simples das margens mensais validas (receita > 0)
    const mediaMargens = (celulas: { margem: number | null }[]): number | null => {
      const validas = celulas.map(c => c.margem).filter((m): m is number => m != null);
      if (validas.length === 0) return null;
      return validas.reduce((a, b) => a + b, 0) / validas.length;
    };

    const linhas = unidades
      .map(u => {
        const celulas = meses.map(m => {
          const { receita, despesa } = dados[u.id][m.key];
          const resultado = receita - despesa;
          const margem = receita > 0 ? (resultado / receita) * 100 : null;
          return { mesKey: m.key, receita, despesa, resultado, margem };
        });
        return {
          id: u.id,
          nome: u.nome,
          cor: u.cor,
          celulas,
          media: mediaMargens(celulas),
        };
      })
      .filter(l => l.celulas.some(c => c.receita > 0 || c.despesa > 0));

    // Total geral por mes + media
    const totaisCelulas = meses.map(m => {
      let receita = 0, despesa = 0;
      for (const l of linhas) {
        const c = l.celulas.find(c => c.mesKey === m.key);
        if (c) { receita += c.receita; despesa += c.despesa; }
      }
      const resultado = receita - despesa;
      const margem = receita > 0 ? (resultado / receita) * 100 : null;
      return { mesKey: m.key, receita, despesa, resultado, margem };
    });
    const totais = { celulas: totaisCelulas, media: mediaMargens(totaisCelulas) };

    return { meses, linhas, totais };
  }, [cp, cr, unidades, mesRef]);

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
    <div className="max-w-[1440px] mx-auto px-6 py-4 animate-fade-in space-y-5">
      {/* Header */}
      <header className="flex justify-between items-center mb-3 pb-3 border-b border-border/50 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1
              className="text-[1.2rem] font-extrabold tracking-tight flex items-center gap-2 flex-wrap"
              style={{
                backgroundImage: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Dashboard · Financeiro
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[0.65rem] font-semibold">
              <Wifi size={11} /> Banco Local
            </span>
            <span className="text-muted-foreground text-[0.65rem]">Visão estratégica — {sub}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative z-[15]">
          {/* Mês de referência */}
          <div className="relative" ref={mesContainerRef}>
            <button
              className={cn(
                'flex items-center gap-1.5 bg-card/75 border border-border px-2.5 py-1.5 rounded-lg text-xs transition-all min-w-[180px] justify-between backdrop-blur',
                showMesDropdown ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/40'
              )}
              onClick={() => setShowMesDropdown(d => !d)}
            >
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays size={13} style={{ color: accentColor }} />
                <span className="text-xs text-foreground font-medium">{mesRefLabel}</span>
              </div>
              <ChevronDown size={11} className={cn('text-muted-foreground transition-transform', showMesDropdown && 'rotate-180')} />
            </button>
            {showMesDropdown && (
              <div className="absolute top-[calc(100%+6px)] right-0 bg-popover border border-border rounded-xl p-1.5 z-[60] min-w-[200px] max-h-[360px] overflow-y-auto shadow-2xl">
                {mesesLista.map(m => {
                  const isSel = m.value === mesRef;
                  return (
                    <button
                      key={m.value}
                      className={cn(
                        'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors',
                        isSel ? 'font-semibold text-white' : 'text-foreground hover:bg-black/5'
                      )}
                      style={isSel ? { background: accentColor } : {}}
                      onClick={() => { setMesRef(m.value); setShowMesDropdown(false); }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
            <RefreshCw size={14} className={cn('mr-1.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-red-700 text-sm">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards — estilo Contas a Receber */}
      <div className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
        {/* Resultado do mes */}
        <Card className="relative overflow-hidden p-4">
          <div className={cn('absolute top-0 left-0 h-1 w-full', kpis.resultadoMes >= 0 ? 'bg-emerald-500' : 'bg-red-500')} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                Resultado do mês
                <HelpHint text="Receita recebida (CR quitado) menos despesa paga (CP quitado) no mês de referência. Considera data_pagamento, não vencimento. Variação % comparada ao mês anterior." />
              </p>
              <p className={cn('text-xl font-bold mt-1', kpis.resultadoMes >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                R$ {fmtBRL(kpis.resultadoMes)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                Receb. R$ {fmtCompact(kpis.recebidoMes)} − Pago R$ {fmtCompact(kpis.pagoMes)}
              </p>
            </div>
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', kpis.resultadoMes >= 0 ? 'bg-emerald-100' : 'bg-red-100')}>
              <Wallet size={18} className={kpis.resultadoMes >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            </div>
          </div>
        </Card>

        {/* Resultado previsto */}
        <Card className="relative overflow-hidden p-4">
          <div className={cn('absolute top-0 left-0 h-1 w-full', kpis.resultadoPrevisto >= 0 ? 'bg-emerald-500' : 'bg-red-500')} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                Resultado previsto
                <HelpHint text="Diferença entre parcelas de CR e CP com vencimento no mês de referência, considerando apenas parcelas não canceladas (independente de terem sido pagas)." />
              </p>
              <p className={cn('text-xl font-bold mt-1', kpis.resultadoPrevisto >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                R$ {fmtBRL(kpis.resultadoPrevisto)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                Rec. R$ {fmtCompact(kpis.previstoReceber)} − Desp. R$ {fmtCompact(kpis.previstoPagar)}
              </p>
            </div>
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', kpis.resultadoPrevisto >= 0 ? 'bg-emerald-100' : 'bg-red-100')}>
              <TrendingUp size={18} className={kpis.resultadoPrevisto >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            </div>
          </div>
        </Card>

        {/* Margem operacional — media 12m */}
        <Card className="relative overflow-hidden p-4">
          <div className={cn('absolute top-0 left-0 h-1 w-full', kpis.margem12m >= 0 ? 'bg-emerald-500' : 'bg-red-500')} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                Margem Operacional
                <HelpHint text="Média simples das margens mensais ((Receita − Despesa) ÷ Receita × 100) apuradas nos últimos 12 meses que terminam no mês de referência. Meses sem receita são ignorados no cálculo." />
              </p>
              <p className={cn('text-xl font-bold mt-1', kpis.margem12m >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                {kpis.margem12m.toFixed(1)}%
              </p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                média dos últimos 12 meses
              </p>
            </div>
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', kpis.margem12m >= 0 ? 'bg-emerald-100' : 'bg-red-100')}>
              <Percent size={18} className={kpis.margem12m >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            </div>
          </div>
        </Card>

        {/* Ticket medio — ultimo ano */}
        <Card className="relative overflow-hidden p-4">
          <div className="absolute top-0 left-0 h-1 w-full" style={{ background: accentColor }} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.7rem] text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                Ticket Médio
                <HelpHint text="Total recebido nos últimos 12 meses (terminando no mês de referência) dividido pelo número de sacados (alunos) distintos que pagaram alguma parcela no mesmo período." />
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: accentColor }}>
                R$ {fmtBRL(kpis.ticketMedio12m)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                {kpis.sacados12m} sacado{kpis.sacados12m !== 1 ? 's' : ''} nos últimos 12 meses
              </p>
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${accentColor}18` }}>
              <Users size={18} style={{ color: accentColor }} />
            </div>
          </div>
        </Card>
      </div>

      {/* Tabela Margem operacional por Unidade × Mês — estilo Planejamento */}
      <Card className="overflow-hidden border-0 shadow-md p-0" style={{ borderTop: `3px solid ${accentColor}` }}>
        <div className="px-5 py-2.5 flex items-center justify-between" style={{ background: accentColor }}>
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-white/80" />
            <span className="text-[0.72rem] font-bold text-white uppercase tracking-widest">
              Margem Operacional · 6 meses (até {mesRefLabel})
            </span>
            <span
              title="Margem mensal de cada unidade nos últimos 6 meses ((Receita − Despesa) ÷ Receita × 100, considerando data de pagamento). A coluna 'Média 6m' é a média simples das margens mensais válidas — meses sem receita são ignorados. O degradê de cores (vermelho → verde) indica a saúde financeira de cada célula."
              className="inline-flex items-center text-white/70 hover:text-white cursor-help"
            >
              <Info size={13} />
            </span>
          </div>
          {loading && <RefreshCw size={11} className="animate-spin text-white/70" />}
        </div>

        {margemMatriz.linhas.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Sem dados suficientes no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: `${accentColor}15` }}>
                  <th
                    className="text-left px-4 py-2 font-bold text-[0.6rem] text-slate-500 uppercase tracking-widest whitespace-nowrap min-w-[150px] border-b border-r"
                    style={{ borderColor: `${accentColor}25` }}
                  >
                    Unidade
                  </th>
                  {margemMatriz.meses.map(m => {
                    const isRef = m.key === mesRef;
                    return (
                      <th
                        key={m.key}
                        className="text-center px-3 py-2 font-bold text-[0.6rem] uppercase tracking-widest whitespace-nowrap border-b min-w-[80px]"
                        style={{
                          borderColor: `${accentColor}25`,
                          background: isRef ? accentColor : undefined,
                          color: isRef ? '#fff' : undefined,
                        }}
                      >
                        {m.label}
                      </th>
                    );
                  })}
                  <th
                    className="text-center px-3 py-2 font-bold text-[0.6rem] uppercase tracking-widest whitespace-nowrap border-b border-l min-w-[90px]"
                    style={{
                      borderColor: `${accentColor}25`,
                      background: `${accentColor}30`,
                      color: accentColor,
                    }}
                    title="Média simples das margens mensais válidas nos últimos 6 meses"
                  >
                    Média 6m
                  </th>
                </tr>
              </thead>

              <tbody>
                {margemMatriz.linhas.map((linha, idx) => (
                  <tr
                    key={linha.id}
                    className="hover:brightness-95 transition-all border-b"
                    style={{
                      borderColor: `${accentColor}15`,
                      background: idx % 2 === 0 ? '#fff' : `${accentColor}05`,
                    }}
                  >
                    <td className="px-4 py-2 whitespace-nowrap border-r" style={{ borderColor: `${accentColor}20` }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: linha.cor }} />
                        <span className="font-bold text-[0.68rem]" style={{ color: linha.cor }}>{linha.nome}</span>
                      </div>
                    </td>
                    {linha.celulas.map(c => {
                      const isRef = c.mesKey === mesRef;
                      return (
                        <td
                          key={c.mesKey}
                          className="text-center px-3 py-2 tabular-nums text-[0.68rem] transition-all"
                          style={{
                            backgroundColor: margemBg(c.margem),
                            outline: isRef ? `2px solid ${accentColor}55` : undefined,
                            outlineOffset: '-2px',
                            color: c.margem == null ? '#d1d5db' : c.margem < 0 ? '#b91c1c' : '#065f46',
                            fontWeight: c.margem != null ? 600 : 400,
                          }}
                          title={`Receita R$ ${fmtBRL(c.receita)} · Despesa R$ ${fmtBRL(c.despesa)} · Resultado R$ ${fmtBRL(c.resultado)}`}
                        >
                          {c.margem == null ? '—' : `${c.margem.toFixed(1)}%`}
                        </td>
                      );
                    })}
                    {/* Media dos 6 meses */}
                    <td
                      className="text-center px-3 py-2 tabular-nums text-[0.68rem] border-l font-bold"
                      style={{
                        borderColor: `${accentColor}40`,
                        backgroundColor: `${accentColor}12`,
                        color: linha.media == null ? '#d1d5db' : linha.media < 0 ? '#b91c1c' : accentColor,
                      }}
                      title="Média simples das margens mensais nos últimos 6 meses"
                    >
                      {linha.media == null ? '—' : `${linha.media.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}

                {margemMatriz.linhas.length > 1 && (
                  <tr style={{ background: accentColor }}>
                    <td className="px-4 py-2.5 whitespace-nowrap border-r border-white/20">
                      <span className="font-extrabold text-[0.65rem] uppercase tracking-widest text-white">Total Geral</span>
                    </td>
                    {margemMatriz.totais.celulas.map(t => {
                      const isRef = t.mesKey === mesRef;
                      return (
                        <td
                          key={t.mesKey}
                          className="text-center px-3 py-2.5 tabular-nums text-[0.68rem] font-extrabold"
                          style={{
                            color: t.margem == null ? 'rgba(255,255,255,0.3)' : '#fff',
                            background: isRef ? 'rgba(0,0,0,0.15)' : undefined,
                          }}
                          title={`Receita R$ ${fmtBRL(t.receita)} · Despesa R$ ${fmtBRL(t.despesa)} · Resultado R$ ${fmtBRL(t.resultado)}`}
                        >
                          {t.margem == null ? '—' : `${t.margem.toFixed(1)}%`}
                        </td>
                      );
                    })}
                    {/* Media dos 6 meses — total geral */}
                    <td
                      className="text-center px-3 py-2.5 tabular-nums text-[0.68rem] font-extrabold border-l border-white/20"
                      style={{
                        color: margemMatriz.totais.media == null ? 'rgba(255,255,255,0.3)' : '#fff',
                        background: 'rgba(0,0,0,0.25)',
                      }}
                      title="Média simples das margens consolidadas dos últimos 6 meses"
                    >
                      {margemMatriz.totais.media == null ? '—' : `${margemMatriz.totais.media.toFixed(1)}%`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Gráfico 1 — Fluxo de Caixa 12m */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Fluxo de Caixa — últimos 12 meses
            <HelpHint text="Barras verdes = receita recebida (CR quitado) no mês. Barras vermelhas = despesa paga (CP quitado) no mês, apresentadas abaixo do eixo para contraste. Linha = resultado do mês (receita − despesa), positivo quando sobrou caixa e negativo quando foi déficit. Todos os valores usam a data de pagamento, não de vencimento." />
          </h2>
          <p className="text-xs text-muted-foreground">Receita × Despesa + resultado do mês</p>
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
              <Line type="monotone" dataKey="saldo" name="Resultado do mês" stroke={accentColor} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Gráfico 2a — Resultado Acumulado 12m */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Resultado acumulado — últimos 12 meses
            <HelpHint text="Cada barra mostra a soma acumulada dos resultados mensais (receita − despesa) desde o primeiro mês exibido até aquele mês. Verde = acumulado positivo (sobra de caixa no período); vermelho = acumulado negativo (déficit no período). Base em data de pagamento, mesmos critérios do Fluxo de Caixa acima." />
          </h2>
          <p className="text-xs text-muted-foreground">Soma corrente dos resultados mensais</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={fluxo12m} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `R$ ${fmtBRL(v)}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="acumulado" name="Resultado acumulado" radius={[4, 4, 0, 0]}>
                {fluxo12m.map((d, i) => (
                  <Cell key={i} fill={d.acumulado >= 0 ? '#10b981' : '#ef4444'} />
                ))}
                <LabelList
                  dataKey="acumulado"
                  position="top"
                  formatter={(v: number) => `R$ ${fmtCompact(v)}`}
                  style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Gráfico 2 — Previsto x Realizado */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Previsto × Realizado — 12 meses
            <HelpHint text="Previsto = soma das parcelas com vencimento no mês, não canceladas (usa valor_parcela). Realizado = soma das parcelas efetivamente pagas/recebidas no mês (usa data_pagamento e valor_pago quando disponível). Verde claro/escuro = Contas a Receber; vermelho claro/escuro = Contas a Pagar. Permite ver gaps entre o planejado e o executado." />
          </h2>
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
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              Aging — CP próximos 90 dias
              <HelpHint text="Contas a pagar em aberto (não pagas, não canceladas) distribuídas em 3 faixas por dias até o vencimento. Vermelho = já vencido (em atraso). Laranja = a vencer. Considera intervalo de ±90 dias em torno de hoje." />
            </h2>
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
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              Comparativo entre Unidades — mês atual
              <HelpHint text="Para o mês de referência: receita recebida (verde), despesa paga (vermelho) e resultado (receita − despesa; azul se positivo, vermelho escuro se negativo) por unidade. Ordenado por resultado (maior → menor). Só aparecem unidades com movimentação no mês." />
            </h2>
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
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Top 20 Inadimplentes — Contas a Receber
            <HelpHint text="Sacados (alunos ou responsáveis) com maior valor em aberto vencido no CR. Agrupa todas as parcelas vencidas e não quitadas do mesmo sacado. 'Dias em atraso' é o maior atraso entre suas parcelas — pintado de vermelho se > 60d, âmbar se > 30d." />
          </h2>
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
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Compromissos CP — próximos 30 dias
            <HelpHint text="Contas a pagar em aberto (não pagas, não canceladas) com vencimento entre hoje e os próximos 30 dias. Ordenado pela data de vencimento (mais próxima primeiro). Limite de 20 registros." />
          </h2>
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

      {loading && (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <RefreshCw size={14} className="animate-spin mr-2" /> Carregando…
        </div>
      )}
    </div>
  );
}
