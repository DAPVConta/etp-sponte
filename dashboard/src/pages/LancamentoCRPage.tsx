import { useEffect, useMemo, useState } from 'react';
import { DollarSign, RefreshCw, AlertCircle, Search, FileText } from 'lucide-react';
import type { Unidade } from '../types';
import { ContasReceberAPI, type LancamentoCR } from '../api/contasReceber';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import RelatorioCRModal from './RelatorioCRModal';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v);
}
function fmtDateBR(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function getMesesAno(): { value: string; label: string }[] {
  const ano = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => ({
    value: `${ano}-${String(i + 1).padStart(2, '0')}`,
    label: `${MESES_PT[i]} ${ano}`,
  }));
}

interface Props {
  unidades: Unidade[];
  activeUnidade: Unidade | null;
  accentColor: string;
}

export default function LancamentoCRPage({ unidades, activeUnidade, accentColor }: Props) {
  const [lancamentos, setLancamentos] = useState<LancamentoCR[]>([]);
  const [loading, setLoading]         = useState(false);
  const [erro, setErro]               = useState('');
  const [relatorioAberto, setRelatorioAberto] = useState(false);

  // Filtros (Unidade vem do TopBar/activeUnidade)
  const [mes, setMes]                 = useState<string>('');
  const [situacao, setSituacao]       = useState<string>('');
  const [categoria, setCategoria]     = useState<string>('');
  const [search, setSearch]           = useState('');

  const unidadeIds = useMemo(
    () => (activeUnidade ? [activeUnidade.id] : unidades.map(u => u.id)),
    [activeUnidade, unidades]
  );
  const unidadesMap = useMemo(() => {
    const m = new Map<string, Unidade>();
    for (const u of unidades) m.set(u.id, u);
    return m;
  }, [unidades]);

  const carregar = async () => {
    if (!unidadeIds.length) return;
    setLoading(true);
    setErro('');
    try {
      const data = await ContasReceberAPI.listarLancamentos({
        unidadeIds,
        mes: mes || null,
        situacao: situacao || null,
        categoria: categoria || null,
      });
      setLancamentos(data);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErro(err?.message || 'Erro ao carregar lançamentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line
  }, [unidadeIds.join(','), mes, situacao, categoria]);

  // Ordenação: data_pagamento desc, depois vencimento desc
  const lancamentosOrdenados = useMemo(() => {
    const arr = [...lancamentos];
    arr.sort((a, b) => {
      const da = a.dataPagamento || '';
      const db = b.dataPagamento || '';
      if (da !== db) return db.localeCompare(da);
      const va = a.vencimento || '';
      const vb = b.vencimento || '';
      return vb.localeCompare(va);
    });
    return arr;
  }, [lancamentos]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lancamentosOrdenados;
    return lancamentosOrdenados.filter(l =>
      l.sacado.toLowerCase().includes(q) ||
      l.categoria.toLowerCase().includes(q) ||
      l.numeroParcela.toLowerCase().includes(q) ||
      (l.alunoId != null && String(l.alunoId).includes(q))
    );
  }, [lancamentosOrdenados, search]);

  // Opções de situação e categoria derivadas do universo da empresa
  const [opcoes, setOpcoes] = useState<{ situacoes: string[]; categorias: string[] }>({ situacoes: [], categorias: [] });
  useEffect(() => {
    if (!unidadeIds.length) return;
    ContasReceberAPI.listarLancamentos({ unidadeIds, mes: mes || null })
      .then(data => {
        setOpcoes({
          situacoes:  Array.from(new Set(data.map(d => d.situacaoParcela).filter(Boolean))).sort(),
          categorias: Array.from(new Set(data.map(d => d.categoria).filter(Boolean))).sort(),
        });
      })
      .catch(() => {});
  }, [unidadeIds.join(','), mes]);

  const totalValorPago   = filtrados.reduce((s, l) => s + l.valorPago, 0);
  const totalValorParcela = filtrados.reduce((s, l) => s + l.valorParcela, 0);

  const mesesDisp = getMesesAno();

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">

      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3" style={{ color: accentColor }}>
            <DollarSign size={26} /> Lançamento CR
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Mensalidades e demais contas a receber — filtre por unidade, mês, situação e categoria.</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw size={13} className="animate-spin" /> Carregando...
            </span>
          )}
          <button
            onClick={() => setRelatorioAberto(true)}
            disabled={!activeUnidade || !mes}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-semibold shadow-sm hover:brightness-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: accentColor }}
            title={!activeUnidade ? 'Selecione uma unidade' : !mes ? 'Selecione um mês' : 'Gerar relatório'}
          >
            <FileText size={13} /> Relatório
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700 text-sm mb-6">
          <AlertCircle size={16} /><span>{erro}</span>
        </div>
      )}

      {/* Filtros */}
      <Card className="px-5 py-3 mb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Unidade</span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border text-xs font-medium bg-slate-50">
            {activeUnidade
              ? <>
                  <span className="w-2 h-2 rounded-full" style={{ background: activeUnidade.cor }} />
                  {activeUnidade.nome}
                </>
              : <>Todas ({unidades.length})</>}
          </span>

          <div className="w-px h-5 bg-border/60" />

          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Mês</span>
          <select
            value={mes}
            onChange={e => setMes(e.target.value)}
            className="h-8 rounded-lg border border-border bg-white px-2 text-xs font-medium focus:border-primary focus:outline-none"
          >
            <option value="">Todos</option>
            {mesesDisp.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          <div className="w-px h-5 bg-border/60" />

          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Situação</span>
          <select
            value={situacao}
            onChange={e => setSituacao(e.target.value)}
            className="h-8 rounded-lg border border-border bg-white px-2 text-xs font-medium focus:border-primary focus:outline-none"
          >
            <option value="">Todas</option>
            {opcoes.situacoes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <div className="w-px h-5 bg-border/60" />

          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Categoria</span>
          <select
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
            className="h-8 rounded-lg border border-border bg-white px-2 text-xs font-medium focus:border-primary focus:outline-none min-w-[180px]"
          >
            <option value="">Todas</option>
            {opcoes.categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="ml-auto relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Pesquisar aluno/categoria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-8 text-xs min-w-[240px]"
            />
          </div>
        </div>
      </Card>

      {/* Lista */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <DollarSign size={17} style={{ color: accentColor }} />
            Lançamentos
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/15">
              {filtrados.length}
            </span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidade</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Aluno</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Parcela</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Data Pagamento</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Vencimento</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Categoria</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Valor Pago</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    Nenhum lançamento encontrado.
                  </TableCell>
                </TableRow>
              )}

              {filtrados.map(l => {
                const u = unidadesMap.get(l.unidadeId);
                return (
                  <TableRow key={`${l.contaReceberId}-${l.numeroParcela}-${l.unidadeId}`} className="hover:bg-slate-50/40 transition-colors">
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: u?.cor || '#cbd5e1' }} />
                        <span className="font-semibold text-xs" style={{ color: u?.cor || '#64748b' }}>
                          {u?.nome || '—'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-sm text-slate-700">
                      <div className="truncate max-w-[260px]" title={l.sacado}>{l.sacado || '—'}</div>
                    </TableCell>
                    <TableCell className="py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">{l.numeroParcela}</TableCell>
                    <TableCell className="py-2 text-sm tabular-nums whitespace-nowrap">{fmtDateBR(l.dataPagamento)}</TableCell>
                    <TableCell className="py-2 text-sm tabular-nums whitespace-nowrap">{fmtDateBR(l.vencimento)}</TableCell>
                    <TableCell className="py-2 text-sm text-slate-600">{l.categoria || '—'}</TableCell>
                    <TableCell className="py-2 text-right text-sm tabular-nums font-semibold text-slate-700">{fmtBRL(l.valorPago)}</TableCell>
                    <TableCell className="py-2">
                      <SituacaoBadgeCR situacao={l.situacaoParcela} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>

            {filtrados.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="font-bold text-sm">
                    TOTAL ({filtrados.length})
                    <span className="text-muted-foreground font-normal ml-3">Parcelas: {fmtBRL(totalValorParcela)}</span>
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-emerald-700">{fmtBRL(totalValorPago)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </Card>

      {relatorioAberto && activeUnidade && mes && (
        <RelatorioCRModal
          unidade={activeUnidade}
          mes={mes}
          accentColor={accentColor}
          onClose={() => setRelatorioAberto(false)}
        />
      )}
    </div>
  );
}

function SituacaoBadgeCR({ situacao }: { situacao: string }) {
  const s = (situacao || '').toLowerCase();
  const isRecebida  = s.includes('receb') || s.includes('pag') || s.includes('quit');
  const isAReceber  = s.includes('a receber') || s.includes('pend') || s.includes('aberto');
  const isVencida   = s.includes('venc') || s.includes('atras');
  const isCancelada = s.includes('cancel');

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[0.68rem] font-semibold border whitespace-nowrap',
      isRecebida  && 'bg-emerald-50 text-emerald-700 border-emerald-200',
      isVencida   && 'bg-red-50 text-red-700 border-red-200',
      isAReceber  && !isVencida && 'bg-amber-50 text-amber-700 border-amber-200',
      isCancelada && 'bg-slate-100 text-slate-500 border-slate-200',
      !isRecebida && !isAReceber && !isVencida && !isCancelada && 'bg-slate-50 text-slate-600 border-slate-200'
    )}>
      {situacao || '—'}
    </span>
  );
}
