import { useState, useCallback, useRef, useEffect } from 'react';
import {
  CalendarDays, TrendingUp, Save, RefreshCw, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Target, BarChart3, Plus, Minus, Check, Star, Search,
} from 'lucide-react';
import type { Unidade } from '../types';
import { PlanejamentoAPI, type ItemPlanejamento } from '../api/planejamento';
import { FavoritosAPI } from '../api/favoritos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function getMesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMesesFuturos(qtd = 11) {
  const result: { value: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i <= qtd; i++) {
    const date = new Date(d.getFullYear(), d.getMonth() + i, 1);
    result.push({ value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: `${MESES_PT[date.getMonth()]} ${date.getFullYear()}` });
  }
  return result;
}

function fmt(v: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v); }
function parseMoeda(str: string): number {
  const n = parseFloat(str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

interface Props { unidades: Unidade[]; accentColor: string; }

export default function PlanejamentoPage({ unidades, accentColor }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([getMesAtual()]);
  const [showMesDropdown, setShowMesDropdown] = useState(false);
  const mesesDisponiveis = getMesesFuturos(11);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [apenasF, setApenasF] = useState(false);
  const [searchCat, setSearchCat] = useState('');
  const [itens, setItens] = useState<ItemPlanejamento[]>([]);
  const [loadingMedias, setLoadingMedias] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [erroMsg, setErroMsg] = useState('');
  const [tabelaVisivel, setTabelaVisivel] = useState(false);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    FavoritosAPI.listar().then(lista => setFavoritos(new Set(lista))).catch(console.error);
  }, []);

  const itensFiltrados = itens.filter(i => {
    if (apenasF && favoritos.size > 0 && !favoritos.has(i.categoria)) return false;
    if (searchCat && !i.categoria.toLowerCase().includes(searchCat.toLowerCase())) return false;
    return true;
  });

  const toggleUnidade = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setItens([]); setTabelaVisivel(false); setSaveStatus('idle');
  }, []);

  const toggleTodasUnidades = useCallback(() => {
    setSelectedIds(prev => prev.size === unidades.length ? new Set() : new Set(unidades.map(u => u.id)));
    setItens([]); setTabelaVisivel(false);
  }, [unidades]);

  const toggleMes = useCallback((value: string) => {
    setMesesSelecionados(prev => {
      if (prev.includes(value)) { if (prev.length === 1) return prev; return prev.filter(m => m !== value); }
      return [...prev, value].sort();
    });
    setItens([]); setTabelaVisivel(false);
  }, []);

  const carregarMedias = useCallback(async () => {
    if (!selectedIds.size) return;
    setLoadingMedias(true); setErroMsg(''); setSaveStatus('idle');
    try {
      const mediasResults = await PlanejamentoAPI.calcularMedias([...selectedIds]);
      const mesPrincipal = mesesSelecionados[0];
      const salvos = await PlanejamentoAPI.buscar([...selectedIds], mesPrincipal);
      setItens(mediasResults.map(item => {
        const salvo = salvos.find(s => s.categoria === item.categoria);
        return { ...item, valorPlanejado: salvo ? salvo.valor_planejado : item.mediaSeisMeses, observacao: salvo?.observacao || '' };
      }));
      setTabelaVisivel(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErroMsg(e?.message || 'Erro ao carregar dados');
    } finally { setLoadingMedias(false); }
  }, [selectedIds, mesesSelecionados]);

  const atualizarValor = useCallback((categoria: string, rawValue: string) => {
    setItens(prev => prev.map(item => item.categoria === categoria ? { ...item, valorPlanejado: parseMoeda(rawValue) } : item));
  }, []);

  const atualizarObservacao = useCallback((categoria: string, obs: string) => {
    setItens(prev => prev.map(item => item.categoria === categoria ? { ...item, observacao: obs } : item));
  }, []);

  const salvar = useCallback(async () => {
    const itensParaSalvar = apenasF && favoritos.size > 0 ? itens.filter(i => favoritos.has(i.categoria)) : itens;
    if (!selectedIds.size || !mesesSelecionados.length || !itensParaSalvar.length) return;
    setSaving(true); setSaveStatus('idle'); setErroMsg('');
    try {
      const promises: Promise<void>[] = [];
      for (const unidadeId of selectedIds)
        for (const mes of mesesSelecionados)
          promises.push(PlanejamentoAPI.salvar(unidadeId, mes, itensParaSalvar));
      await Promise.all(promises);
      setSaveStatus('ok');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErroMsg(e?.message || 'Erro ao salvar'); setSaveStatus('error');
    } finally { setSaving(false); }
  }, [selectedIds, mesesSelecionados, itens, apenasF, favoritos]);

  const totalMedia = itensFiltrados.reduce((s, i) => s + i.mediaSeisMeses, 0);
  const totalPlanejado = itensFiltrados.reduce((s, i) => s + i.valorPlanejado, 0);
  const variacaoTotal = totalPlanejado - totalMedia;
  const hasSelection = selectedIds.size > 0;
  const canLoad = hasSelection && mesesSelecionados.length > 0;
  const temFavoritos = favoritos.size > 0;
  const mesesLabel = mesesSelecionados.length === 0 ? 'Selecionar meses'
    : mesesSelecionados.length === 1 ? mesesDisponiveis.find(m => m.value === mesesSelecionados[0])?.label || mesesSelecionados[0]
    : `${mesesSelecionados.length} meses selecionados`;

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3" style={{ color: accentColor }}>
            <Target size={26} /> Planejamento de Despesas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Defina metas de gastos por categoria para as unidades selecionadas.</p>
        </div>
        {tabelaVisivel && (
          <div className="flex items-center gap-3">
            {saveStatus === 'ok' && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={14} /> Salvo com sucesso!
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
                <AlertCircle size={14} /> Erro ao salvar
              </span>
            )}
            <Button onClick={salvar} disabled={saving || !itensFiltrados.length} className="gap-2" style={{ background: accentColor }}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Salvando...' : 'Salvar Planejamento'}
            </Button>
          </div>
        )}
      </div>

      {erroMsg && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700 text-sm mb-6">
          <AlertCircle size={16} /><span>{erroMsg}</span>
        </div>
      )}

      {/* Filters panel */}
      <Card className="p-6 mb-8 flex flex-col gap-5 relative overflow-hidden">
        {/* Units */}
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M3 9h18M9 21V9"/></svg>
            Unidades
            {hasSelection && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${accentColor}22`, color: accentColor }}>
                {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {(() => {
              const allSel = selectedIds.size === unidades.length && unidades.length > 0;
              return (
                <button
                  className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full border-[1.5px] text-sm font-medium transition-all", allSel ? "text-white" : "bg-transparent text-muted-foreground border-border hover:bg-black/5 hover:text-foreground hover:border-border")}
                  style={allSel ? { borderColor: accentColor, background: accentColor, boxShadow: `0 0 0 3px ${accentColor}33` } : {}}
                  onClick={toggleTodasUnidades}
                >
                  {allSel ? <Check size={13} strokeWidth={3} /> : <span className="w-2 h-2 rounded-full bg-primary" />} Todas
                </button>
              );
            })()}
            {unidades.map(u => {
              const sel = selectedIds.has(u.id);
              return (
                <button key={u.id}
                  className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full border-[1.5px] text-sm font-medium transition-all", sel ? "text-white" : "bg-transparent text-muted-foreground border-border hover:bg-black/5 hover:text-foreground hover:border-border")}
                  style={sel ? { borderColor: u.cor, background: u.cor, boxShadow: `0 0 0 3px ${u.cor}44` } : {}}
                  onClick={() => toggleUnidade(u.id)}
                >
                  {sel ? <Check size={13} strokeWidth={3} /> : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: u.cor }} />}
                  {u.nome}
                </button>
              );
            })}
            {unidades.length === 0 && <p className="text-muted-foreground text-sm">Nenhuma unidade cadastrada.</p>}
          </div>
        </div>

        <div className="h-px bg-border/50" />

        {/* Month selector */}
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <CalendarDays size={14} />
            Meses do Planejamento
            {mesesSelecionados.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: `${accentColor}22`, color: accentColor }}>
                {mesesSelecionados.length} mês{mesesSelecionados.length !== 1 ? 'es' : ''}
              </span>
            )}
          </p>
          <div className="relative w-fit">
            <button
              className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm cursor-pointer transition-all min-w-[240px] justify-between", showMesDropdown ? "border-primary" : "border-border bg-background/50 hover:border-primary/40")}
              onClick={() => setShowMesDropdown(d => !d)}
            >
              <CalendarDays size={14} style={{ color: accentColor }} />
              <span className="flex-1 text-left">{mesesLabel}</span>
              {showMesDropdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showMesDropdown && (
              <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-xl p-1.5 z-50 min-w-[240px] max-h-[340px] overflow-y-auto shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
                {mesesDisponiveis.map(m => {
                  const isSelected = mesesSelecionados.includes(m.value);
                  const isCurrent = m.value === getMesAtual();
                  return (
                    <button key={m.value}
                      className={cn("flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left transition-all", isSelected ? "font-semibold" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}
                      style={isSelected ? { background: `${accentColor}18`, color: accentColor } : {}}
                      onClick={() => toggleMes(m.value)}
                    >
                      <span className="w-4 flex items-center justify-center flex-shrink-0">
                        {isSelected ? <CheckCircle2 size={13} /> : <span className="w-3.5 h-3.5 rounded-full border-[1.5px] border-border" />}
                      </span>
                      {m.label}
                      {isCurrent && (
                        <span className="ml-auto text-[0.65rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Atual</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-border/50" />

        {/* Favorites filter */}
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <Star size={13} className="text-amber-400" />
            Categorias Favoritas
            {temFavoritos && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400">
                {favoritos.size} favorita{favoritos.size !== 1 ? 's' : ''}
              </span>
            )}
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            {[
              { active: !apenasF, label: 'Todas as categorias', onClick: () => setApenasF(false), color: accentColor },
              { active: apenasF, label: 'Apenas favoritas', onClick: () => setApenasF(true), disabled: !temFavoritos, yellow: true },
            ].map((btn, i) => (
              <button key={i} disabled={btn.disabled}
                className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full border-[1.5px] text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed")}
                style={btn.active
                  ? btn.yellow
                    ? { borderColor: '#f59e0b', background: '#f59e0b', color: '#0f172a', boxShadow: '0 0 0 3px rgba(245,158,11,0.3)' }
                    : { borderColor: btn.color, background: btn.color, color: '#fff', boxShadow: `0 0 0 3px ${btn.color}33` }
                  : btn.yellow
                    ? { borderColor: 'rgba(245,158,11,0.4)', color: '#f59e0b', background: 'transparent' }
                    : { borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))', background: 'rgba(255,255,255,0.02)' }}
                onClick={btn.onClick}
              >
                {btn.active ? <Check size={13} strokeWidth={3} /> : btn.yellow ? <Star size={13} /> : null}
                {btn.label}
                {btn.disabled && <span className="text-[0.7rem] opacity-70">(nenhuma)</span>}
              </button>
            ))}
            {!temFavoritos && (
              <span className="text-muted-foreground text-sm">Acesse <strong>Categorias de Despesas</strong> para marcar favoritos ★</span>
            )}
          </div>
        </div>

        {/* Load button */}
        <div className="flex justify-end">
          <Button
            onClick={carregarMedias}
            disabled={!canLoad || loadingMedias}
            className="gap-2"
            style={{ background: accentColor, opacity: canLoad ? 1 : 0.5 }}
          >
            {loadingMedias ? <><RefreshCw size={14} className="animate-spin" /> Carregando...</> : <><BarChart3 size={14} /> Carregar Categorias</>}
          </Button>
        </div>
      </Card>

      {/* Loading */}
      {loadingMedias && (
        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
          <div className="w-11 h-11 rounded-full border-[3px] border-primary/20 animate-spin" style={{ borderTopColor: accentColor }} />
          <p className="text-muted-foreground">Calculando médias dos últimos 6 meses...</p>
        </div>
      )}

      {/* Table content */}
      {tabelaVisivel && !loadingMedias && itens.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-5 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
            {[
              { icon: <TrendingUp size={19} />, color: `${accentColor}22`, textColor: accentColor, label: 'Média 6 Meses (Total)', value: fmt(totalMedia) },
              { icon: <Target size={19} />, color: 'rgba(16,185,129,0.15)', textColor: '#10b981', label: 'Total Planejado', value: fmt(totalPlanejado) },
              {
                icon: variacaoTotal >= 0 ? <Plus size={19} className="text-red-600" /> : <Minus size={19} className="text-emerald-700" />,
                color: variacaoTotal >= 0 ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                textColor: variacaoTotal >= 0 ? '#ef4444' : '#10b981',
                label: 'Variação vs Média',
                value: `${variacaoTotal >= 0 ? '+' : ''}${fmt(variacaoTotal)}`
              },
              { icon: <CalendarDays size={19} />, color: 'rgba(245,158,11,0.15)', textColor: '#f59e0b', label: 'Meses × Unidades', value: `${mesesSelecionados.length} × ${selectedIds.size}` },
            ].map((c, i) => (
              <Card key={i} className={cn("flex items-center gap-4 px-5 py-4 transition-all hover:-translate-y-0.5 hover:shadow-lg animate-fade-in-up")} style={{ animationDelay: `${i * 80}ms` }}>
                <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center flex-shrink-0 relative" style={{ background: c.color, color: c.textColor }}>
                  <div className="absolute inset-[-2px] rounded-xl opacity-35 blur-2" style={{ background: c.color }} />
                  {c.icon}
                </div>
                <div>
                  <p className="text-[0.68rem] text-muted-foreground font-semibold uppercase tracking-[0.08em] mb-0.5">{c.label}</p>
                  <p className="text-[1.2rem] font-bold tabular-nums" style={{ color: c.textColor }}>{c.value}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* Month tags */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">Planejando para:</span>
            {mesesSelecionados.map(m => (
              <span key={m} className="inline-flex items-center px-3 py-1 rounded-full border text-[0.78rem] font-semibold" style={{ background: `${accentColor}22`, color: accentColor, borderColor: `${accentColor}44` }}>
                {mesesDisponiveis.find(x => x.value === m)?.label || m}
              </span>
            ))}
            {apenasF && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[0.78rem] font-semibold bg-amber-500/15 text-amber-400 border-amber-500/30">
                <Star size={11} fill="#f59e0b" /> apenas favoritas ({itensFiltrados.length})
              </span>
            )}
          </div>

          {/* Editable table */}
          <Card className="overflow-hidden mt-4">
            <div className="flex justify-between items-center px-6 py-4 border-b border-border/50 flex-wrap gap-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <BarChart3 size={17} style={{ color: accentColor }} />
                Categorias de Despesas
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/15">{itensFiltrados.length} categorias</span>
              </h2>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input placeholder="Pesquisar categoria..." value={searchCat} onChange={e => setSearchCat(e.target.value)} className="pl-9 h-9 text-sm min-w-[240px]" />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[35%]">Categoria</TableHead>
                  <TableHead className="text-right">Média 6 meses</TableHead>
                  <TableHead className="text-right min-w-[180px]">Valor Planejado</TableHead>
                  <TableHead className="text-right">Variação</TableHead>
                  <TableHead className="min-w-[200px]">Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itensFiltrados.map((item, idx) => {
                  const variacao = item.valorPlanejado - item.mediaSeisMeses;
                  const varPct = item.mediaSeisMeses > 0 ? ((variacao / item.mediaSeisMeses) * 100).toFixed(1) : '0.0';
                  const isFav = favoritos.has(item.categoria);
                  return (
                    <TableRow key={item.categoria}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-[7px] flex items-center justify-center text-[0.68rem] font-bold flex-shrink-0" style={{ background: `${accentColor}22`, color: accentColor }}>{idx + 1}</span>
                          {item.categoria}
                          {isFav && <Star size={12} fill="#f59e0b" className="text-amber-400 flex-shrink-0 ml-1" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">{fmt(item.mediaSeisMeses)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1.5 bg-background/50 border border-border rounded-lg px-2.5 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/12 transition-all">
                          <span className="text-xs text-muted-foreground font-semibold flex-shrink-0">R$</span>
                          <MoedaInput
                            valor={item.valorPlanejado}
                            inputRef={el => { if (el) inputRefs.current.set(item.categoria, el); }}
                            onChange={n => atualizarValor(item.categoria, n.toString())}
                            onEnter={() => { const next = itensFiltrados[idx + 1]; if (next) inputRefs.current.get(next.categoria)?.focus(); }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn("inline-flex items-baseline gap-1.5 font-semibold tabular-nums text-sm", variacao === 0 ? 'text-muted-foreground' : variacao > 0 ? 'text-red-600' : 'text-emerald-700')}>
                          {variacao > 0 ? '+' : ''}{fmt(variacao)}
                          <span className="text-[0.72rem] opacity-70 font-medium">({variacao >= 0 ? '+' : ''}{varPct}%)</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <input
                          type="text"
                          className="bg-background/35 border-transparent border rounded-lg px-2.5 py-1.5 text-muted-foreground text-sm outline-none w-full focus:border-border focus:text-foreground transition-all placeholder:text-muted-foreground/30"
                          placeholder="Observação opcional..."
                          value={item.observacao || ''}
                          onChange={e => atualizarObservacao(item.categoria, e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {itensFiltrados.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">Nenhuma categoria disponível.</TableCell></TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell><strong>TOTAL{apenasF ? ' (favoritas)' : ''}</strong></TableCell>
                  <TableCell className="text-right"><strong className="tabular-nums">{fmt(totalMedia)}</strong></TableCell>
                  <TableCell className="text-right"><strong className="text-emerald-700 tabular-nums">{fmt(totalPlanejado)}</strong></TableCell>
                  <TableCell className="text-right">
                    <strong className={variacaoTotal === 0 ? 'text-muted-foreground' : variacaoTotal > 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {variacaoTotal >= 0 ? '+' : ''}{fmt(variacaoTotal)}
                    </strong>
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </Card>

          {/* Bottom save */}
          <div className="flex justify-end mt-6 gap-3 items-center">
            {saveStatus === 'ok' && <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-500/8 text-emerald-700 border border-emerald-500/20"><CheckCircle2 size={14} /> Planejamento salvo!</span>}
            {saveStatus === 'error' && <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-red-500/8 text-red-600 border border-red-500/20"><AlertCircle size={14} /> {erroMsg || 'Erro ao salvar'}</span>}
            <Button onClick={salvar} disabled={saving} className="gap-2" style={{ background: accentColor }}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Salvando...' : `Salvar${apenasF ? ' Favoritas' : ''} (${mesesSelecionados.length} mês${mesesSelecionados.length !== 1 ? 'es' : ''})`}
            </Button>
          </div>
        </>
      )}

      {tabelaVisivel && !loadingMedias && itens.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-8 gap-4 text-center py-20">
          <BarChart3 size={48} className="text-muted-foreground/40" />
          <h3 className="text-xl font-bold">Sem dados de despesas</h3>
          <p className="text-muted-foreground text-sm">Não foram encontradas despesas pagas nos últimos 6 meses para as unidades selecionadas.</p>
        </div>
      )}

      {!tabelaVisivel && !loadingMedias && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center relative" style={{ background: `${accentColor}15` }}>
            <div className="absolute inset-[-4px] rounded-2xl opacity-40 blur-[12px]" style={{ background: `${accentColor}15` }} />
            <Target size={40} style={{ color: accentColor, opacity: 0.7 }} />
          </div>
          <h3 className="text-[1.3rem] font-bold">Selecione as unidades e os meses</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">Escolha uma ou mais unidades e os meses que deseja planejar,<br />depois clique em <strong>Carregar Categorias</strong>.</p>
        </div>
      )}
    </div>
  );
}

// ── Custom Currency Input ─────────────────────────────────────────────────────
function MoedaInput({ valor, onChange, onEnter, inputRef }: {
  valor: number; onChange: (n: number) => void; onEnter: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const formatado = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
  const [str, setStr] = useState(formatado);

  useEffect(() => {
    if (Math.abs(parseMoeda(str) - valor) > 0.001)
      setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor));
  }, [valor]); // eslint-disable-line

  const handleBlur = () => {
    const num = parseMoeda(str);
    onChange(num);
    setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num));
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="bg-transparent border-none outline-none text-foreground font-semibold tabular-nums text-sm w-[110px] text-right"
      value={str}
      onChange={e => setStr(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={e => { if (e.key === 'Enter') { const n = parseMoeda(str); onChange(n); setStr(new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)); onEnter(); } }}
      onFocus={e => e.target.select()}
    />
  );
}
