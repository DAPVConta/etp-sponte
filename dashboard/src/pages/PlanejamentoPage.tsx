import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays, TrendingUp, Save, RefreshCw, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Target, BarChart3, Plus, Minus, Check, Star, Search,
  FolderOpen, FolderClosed, Tag, Clock, BarChart2,
} from 'lucide-react';
import type { Unidade } from '../types';
import { PlanejamentoAPI, type ItemPlanejamento } from '../api/planejamento';
import { PlanoContasAPI, type PlanoContasItem } from '../api/planoContas';
import { FavoritosAPI } from '../api/favoritos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────
const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function getMesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getMesesAno() {
  const result: { value: string; label: string }[] = [];
  const ano = new Date().getFullYear();
  for (let mes = 0; mes < 12; mes++) {
    result.push({
      value: `${ano}-${String(mes + 1).padStart(2, '0')}`,
      label: `${MESES_PT[mes]} ${ano}`,
    });
  }
  return result;
}
function fmt(v: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v); }
function parseMoeda(str: string): number {
  const n = parseFloat(str.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// ── Tree types ────────────────────────────────────────────────────────────────
interface RowDespesa  { nome: string; media: number; }
interface RowSubgrupo { key: string; label: string; media: number; despesas: RowDespesa[]; }
interface RowGrupo    { key: string; label: string; media: number; hasSubs: boolean; subgrupos: RowSubgrupo[]; despesasDiretas: RowDespesa[]; }

// ── Valor entry ───────────────────────────────────────────────────────────────
// key format:
//   grupo sem sub-grupos:  "G::{grupoNome}"
//   sub-grupo:             "SG::{grupoNome}::{subNome}"
interface ValorEntry { valor: number; obs: string; }

interface Props { unidades: Unidade[]; activeUnidade: Unidade | null; accentColor: string; }

export default function PlanejamentoPage({ unidades, activeUnidade, accentColor }: Props) {
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>([getMesAtual()]);
  const [showMesDropdown, setShowMesDropdown]     = useState(false);
  const mesesDisponiveis = getMesesAno();

  const [favoritos, setFavoritos]         = useState<Set<string>>(new Set());
  const [apenasF, setApenasF]             = useState(false);
  const [searchCat, setSearchCat]         = useState('');
  const [refMode, setRefMode]             = useState<'media6' | 'ultimomes'>('media6');

  const [treeData, setTreeData]               = useState<RowGrupo[]>([]);
  const [valores, setValores]                 = useState<Map<string, ValorEntry>>(new Map());
  const [collapsedGrupos, setCollapsedGrupos]       = useState<Set<string>>(new Set());
  const [collapsedSubgrupos, setCollapsedSubgrupos] = useState<Set<string>>(new Set());

  // ── Tabela anual ──────────────────────────────────────────────────────────
  const [totaisAnuais, setTotaisAnuais]     = useState<Record<string, Record<string, number>>>({});
  const [loadingAnual, setLoadingAnual]     = useState(false);

  const [loadingMedias, setLoadingMedias]   = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [saveStatus, setSaveStatus]         = useState<'idle' | 'ok' | 'error'>('idle');
  const [erroMsg, setErroMsg]               = useState('');
  const [tabelaVisivel, setTabelaVisivel]   = useState(false);
  const [copiando, setCopiando]             = useState(false);

  const inputRefs   = useRef<Map<string, HTMLInputElement>>(new Map());
  const mesBtnRef   = useRef<HTMLButtonElement>(null);

  // selectedIds derivado de activeUnidade — unidade ativa ou todas
  const selectedIds = useMemo(
    () => activeUnidade ? new Set([activeUnidade.id]) : new Set(unidades.map(u => u.id)),
    [activeUnidade, unidades]
  );

  useEffect(() => {
    FavoritosAPI.listar().then(l => setFavoritos(new Set(l))).catch(console.error);
  }, []);

  // Carregar tabela anual sempre que as unidades mudarem
  useEffect(() => {
    if (!unidades.length) return;
    const allIds = unidades.map(u => u.id);
    setLoadingAnual(true);
    PlanejamentoAPI.totaisAnuaisPorUnidade(allIds, new Date().getFullYear())
      .then(r => setTotaisAnuais(r.totais))
      .catch(console.error)
      .finally(() => setLoadingAnual(false));
  }, [unidades]);

  // ── Helpers reset ─────────────────────────────────────────────────────────
  const resetTable = () => { setTreeData([]); setValores(new Map()); setTabelaVisivel(false); setSaveStatus('idle'); };

  const toggleMes = useCallback((value: string) => {
    setMesesSelecionados([value]);
  }, []);

  // ── Copiar planejamento do mês anterior ──────────────────────────────────
  const copiarMesAnterior = useCallback(async () => {
    if (!selectedIds.size || !mesesSelecionados.length) return;
    setCopiando(true);
    try {
      // Calcular mês anterior ao primeiro mês selecionado
      const [ano, mes] = mesesSelecionados[0].split('-').map(Number);
      const dtAnterior = new Date(ano, mes - 2, 1); // mes-2 pois meses são 0-based
      const mesAnterior = `${dtAnterior.getFullYear()}-${String(dtAnterior.getMonth() + 1).padStart(2, '0')}`;

      const salvos = await PlanejamentoAPI.buscar([...selectedIds], mesAnterior);
      if (salvos.length === 0) return;

      const savedMap = new Map<string, ValorEntry>();
      for (const s of salvos) savedMap.set(s.categoria, { valor: s.valor_planejado, obs: s.observacao || '' });

      // Aplica apenas nas chaves que já existem na árvore atual
      setValores(prev => {
        const n = new Map(prev);
        for (const [key] of n.entries()) {
          const saved = savedMap.get(key);
          if (saved) n.set(key, saved);
        }
        return n;
      });
    } finally {
      setCopiando(false);
    }
  }, [selectedIds, mesesSelecionados]);

  // ── Auto-load quando filtros mudam ───────────────────────────────────────
  useEffect(() => {
    if (selectedIds.size > 0 && mesesSelecionados.length > 0) carregarDados();
  }, [selectedIds, mesesSelecionados, refMode]); // eslint-disable-line

  // ── Load ──────────────────────────────────────────────────────────────────
  const carregarDados = useCallback(async () => {
    if (!selectedIds.size) return;
    setLoadingMedias(true); setErroMsg(''); setSaveStatus('idle');
    try {
      // 1. Plano de contas (merge + dedup)
      const planoResults = await Promise.all(
        [...selectedIds].map(id => PlanoContasAPI.listarPorUnidade(id).catch(() => [] as PlanoContasItem[]))
      );
      const allItems: PlanoContasItem[] = [];
      const seenIds = new Set<string>();
      for (const items of planoResults)
        for (const item of items)
          if (!seenIds.has(item.id)) { seenIds.add(item.id); allItems.push(item); }
      allItems.sort((a, b) => a.sortOrder - b.sortOrder);

      // 2. Valores de referência: média 6 meses ou último mês
      const mediasResult = refMode === 'media6'
        ? await PlanejamentoAPI.calcularMedias([...selectedIds])
        : await PlanejamentoAPI.calcularUltimoMes([...selectedIds]);
      const mediaMap = new Map<string, number>();
      for (const m of mediasResult) mediaMap.set(norm(m.categoria), m.mediaSeisMeses);

      // 3. Valores já salvos
      const salvos = await PlanejamentoAPI.buscar([...selectedIds], mesesSelecionados[0]);
      const savedMap = new Map<string, ValorEntry>();
      for (const s of salvos) savedMap.set(s.categoria, { valor: s.valor_planejado, obs: s.observacao || '' });

      // 4. Montar árvore
      const grupoRows    = allItems.filter(i => i.tipo === 'grupo');
      const subGrupoRows = allItems.filter(i => i.tipo === 'sub_grupo');
      const despesaRows  = allItems.filter(i => i.tipo === 'despesa');
      const getMedia     = (nome: string) => mediaMap.get(norm(nome)) || 0;

      const novosValores = new Map<string, ValorEntry>();
      const tree: RowGrupo[] = [];

      for (const grupo of grupoRows) {
        const grupoKey = `G::${grupo.nome}`;
        const subs     = subGrupoRows.filter(s => s.grupoNome === grupo.nome);
        const subgrupos: RowSubgrupo[] = [];
        let mediaGrupo = 0;

        if (subs.length > 0) {
          for (const sub of subs) {
            const subKey   = `SG::${grupo.nome}::${sub.nome}`;
            const despSub  = despesaRows.filter(d => d.grupoNome === grupo.nome && d.subGrupoNome === sub.nome);
            const mediaSub = despSub.reduce((a, d) => a + getMedia(d.nome), 0);
            mediaGrupo    += mediaSub;
            // sub-grupos: sem input — apenas leitura
            subgrupos.push({ key: subKey, label: sub.nome, media: mediaSub, despesas: despSub.map(d => ({ nome: d.nome, media: getMedia(d.nome) })) });
          }
          const diretas = despesaRows.filter(d => d.grupoNome === grupo.nome && !d.subGrupoNome);
          mediaGrupo   += diretas.reduce((a, d) => a + getMedia(d.nome), 0);
          // Grupo com sub-grupos: tem input próprio
          novosValores.set(grupoKey, savedMap.get(grupoKey) ?? { valor: mediaGrupo, obs: '' });
          tree.push({ key: grupoKey, label: grupo.nome, media: mediaGrupo, hasSubs: true, subgrupos, despesasDiretas: diretas.map(d => ({ nome: d.nome, media: getMedia(d.nome) })) });
        } else {
          const despesas = despesaRows.filter(d => d.grupoNome === grupo.nome);
          mediaGrupo     = despesas.reduce((a, d) => a + getMedia(d.nome), 0);
          novosValores.set(grupoKey, savedMap.get(grupoKey) ?? { valor: mediaGrupo, obs: '' });
          tree.push({ key: grupoKey, label: grupo.nome, media: mediaGrupo, hasSubs: false, subgrupos: [], despesasDiretas: despesas.map(d => ({ nome: d.nome, media: getMedia(d.nome) })) });
        }
      }

      // Despesas orfas — grupo_nome nao casa com nenhum grupo existente (dados legados/mal cadastrados).
      // Agrupa em "SEM GRUPO DEFINIDO" para que todos os valores fiquem visiveis.
      const grupoNomesSet = new Set(grupoRows.map(g => g.nome));
      const orphanDespesas = despesaRows.filter(d => !grupoNomesSet.has(d.grupoNome ?? ''));
      if (orphanDespesas.length > 0) {
        const orphanMedia = orphanDespesas.reduce((a, d) => a + getMedia(d.nome), 0);
        const orphanKey = 'G::__SEM_GRUPO__';
        novosValores.set(orphanKey, savedMap.get(orphanKey) ?? { valor: orphanMedia, obs: '' });
        tree.push({
          key: orphanKey,
          label: 'SEM GRUPO DEFINIDO',
          media: orphanMedia,
          hasSubs: false,
          subgrupos: [],
          despesasDiretas: orphanDespesas.map(d => ({ nome: d.nome, media: getMedia(d.nome) })),
        });
      }

      // Iniciar tudo recolhido
      const allGrupoKeys   = new Set(tree.map(g => g.key));
      const allSubgrupoKeys = new Set(tree.flatMap(g => g.subgrupos.map(s => s.key)));

      setTreeData(tree);
      setValores(novosValores);
      setCollapsedGrupos(allGrupoKeys);
      setCollapsedSubgrupos(allSubgrupoKeys);
      setTabelaVisivel(true);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErroMsg(e?.message || 'Erro ao carregar dados');
    } finally { setLoadingMedias(false); }
  }, [selectedIds, mesesSelecionados, refMode]);

  // ── Edição ────────────────────────────────────────────────────────────────
  const atualizarValor = useCallback((key: string, raw: string) => {
    setValores(prev => {
      const n = new Map(prev);
      n.set(key, { ...(n.get(key) ?? { valor: 0, obs: '' }), valor: parseMoeda(raw) });
      return n;
    });
  }, []);

  const atualizarObs = useCallback((key: string, obs: string) => {
    setValores(prev => {
      const n = new Map(prev);
      n.set(key, { ...(n.get(key) ?? { valor: 0, obs: '' }), obs });
      return n;
    });
  }, []);

  // ── Salvar ────────────────────────────────────────────────────────────────
  const salvar = useCallback(async () => {
    if (!selectedIds.size || !mesesSelecionados.length || !valores.size) return;
    setSaving(true); setSaveStatus('idle'); setErroMsg('');
    try {
      const itens: ItemPlanejamento[] = [];
      for (const [cat, { valor, obs }] of valores.entries())
        itens.push({ categoria: cat, mediaSeisMeses: 0, valorPlanejado: valor, observacao: obs });

      await Promise.all(
        [...selectedIds].flatMap(uid =>
          mesesSelecionados.map(mes => PlanejamentoAPI.salvar(uid, mes, itens))
        )
      );
      setSaveStatus('ok');
      setTimeout(() => setSaveStatus('idle'), 3000);
      // Atualizar tabela anual
      PlanejamentoAPI.totaisAnuaisPorUnidade(unidades.map(u => u.id), new Date().getFullYear())
        .then(r => setTotaisAnuais(r.totais)).catch(console.error);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setErroMsg(e?.message || 'Erro ao salvar'); setSaveStatus('error');
    } finally { setSaving(false); }
  }, [selectedIds, mesesSelecionados, valores]);

  // ── Árvore filtrada ───────────────────────────────────────────────────────
  const filteredTree = useMemo(() => {
    if (!searchCat && !apenasF) return treeData;
    const q = searchCat.toLowerCase();
    return treeData.filter(grupo => {
      const allDespesas = [...grupo.subgrupos.flatMap(s => s.despesas), ...grupo.despesasDiretas];
      if (apenasF && !allDespesas.some(d => favoritos.has(d.nome))) return false;
      if (!q) return true;
      return (
        grupo.label.toLowerCase().includes(q) ||
        grupo.subgrupos.some(s => s.label.toLowerCase().includes(q) || s.despesas.some(d => d.nome.toLowerCase().includes(q))) ||
        grupo.despesasDiretas.some(d => d.nome.toLowerCase().includes(q))
      );
    });
  }, [treeData, searchCat, apenasF, favoritos]);

  // ── Totais ────────────────────────────────────────────────────────────────
  const totalMedia = filteredTree.reduce((s, g) => s + g.media, 0);
  // Total planejado: sempre soma os inputs dos grupos (único nível editável)
  const totalPlanejado = filteredTree.reduce((s, g) => s + (valores.get(g.key)?.valor ?? 0), 0);
  const variacaoTotal = totalPlanejado - totalMedia;

  const hasSelection  = selectedIds.size > 0;
  const canLoad       = hasSelection && mesesSelecionados.length > 0;
  const temFavoritos  = favoritos.size > 0;
  const mesesLabel    = mesesSelecionados.length === 0
    ? 'Selecionar mês'
    : (mesesDisponiveis.find(m => m.value === mesesSelecionados[0])?.label || mesesSelecionados[0]);

  const toggleGrupo    = (key: string) => setCollapsedGrupos   (prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleSubgrupo = (key: string) => setCollapsedSubgrupos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">

      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3" style={{ color: accentColor }}>
            <Target size={26} /> Planejamento de Despesas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Defina metas de gastos por grupo e sub-grupo para as unidades selecionadas.</p>
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
            <Button onClick={salvar} disabled={saving || !filteredTree.length} className="gap-2" style={{ background: accentColor }}>
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

      {/* Tabela anual resumo */}
      <Card className="mb-6 overflow-hidden border-0 shadow-md" style={{ borderTop: `3px solid ${accentColor}` }}>
        {/* Header */}
        <div className="px-5 py-2.5 flex items-center justify-between" style={{ background: accentColor }}>
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-white/80" />
            <span className="text-[0.72rem] font-bold text-white uppercase tracking-widest">Planejamento Anual {new Date().getFullYear()}</span>
          </div>
          {loadingAnual && <RefreshCw size={11} className="animate-spin text-white/70" />}
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: `${accentColor}15` }}>
                <th className="text-left px-4 py-2 font-bold text-[0.6rem] text-slate-500 uppercase tracking-widest whitespace-nowrap min-w-[150px] border-b border-r" style={{ borderColor: `${accentColor}25` }}>
                  Unidade
                </th>
                {MESES_PT.map((m, i) => {
                  const mesVal  = `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                  const isAtual = mesVal === getMesAtual();
                  return (
                    <th key={m}
                      className="text-right px-3 py-2 font-bold text-[0.6rem] uppercase tracking-widest whitespace-nowrap border-b min-w-[80px]"
                      style={{
                        borderColor: `${accentColor}25`,
                        background: isAtual ? accentColor : undefined,
                        color: isAtual ? '#fff' : undefined,
                      }}
                    >
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
                      const isAtual = mesVal === getMesAtual();
                      return (
                        <td key={i}
                          className={cn("text-right px-3 py-2 tabular-nums text-[0.68rem] transition-all", val > 0 && "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-primary/30 hover:brightness-95")}
                          style={{
                            background: isAtual ? `${accentColor}12` : undefined,
                            color: val === 0 ? '#d1d5db' : isAtual ? accentColor : '#334155',
                            fontWeight: val > 0 ? 600 : 400,
                          }}
                          onClick={() => {
                            if (val === 0) return;
                            setMesesSelecionados([mesVal]);
                          }}
                          title={val > 0 ? `Carregar ${MESES_PT[i]} — ${u.nome}` : undefined}
                        >
                          {val === 0 ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Linha total geral */}
              {unidades.length > 1 && (
                <tr style={{ background: accentColor }}>
                  <td className="px-4 py-2.5 whitespace-nowrap border-r border-white/20">
                    <span className="font-extrabold text-[0.65rem] uppercase tracking-widest text-white">Total Geral</span>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const mesVal  = `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`;
                    const total   = unidades.reduce((s, u) => s + (totaisAnuais[u.id]?.[mesVal] || 0), 0);
                    const isAtual = mesVal === getMesAtual();
                    return (
                      <td key={i} className="text-right px-3 py-2.5 tabular-nums text-[0.68rem] font-extrabold"
                        style={{
                          color: total === 0 ? 'rgba(255,255,255,0.3)' : '#fff',
                          background: isAtual ? 'rgba(0,0,0,0.15)' : undefined,
                        }}
                      >
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

      {/* Filters panel — 2 linhas */}
      <Card className="px-5 py-3 mb-6 flex flex-col divide-y divide-border/50">

        {/* Linha 1: Mês */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Mês</span>
          <div className="relative">
            <button
              ref={mesBtnRef}
              className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-medium transition-all min-w-[160px] justify-between", showMesDropdown ? "border-primary" : "border-border hover:border-primary/40")}
              onClick={() => setShowMesDropdown(d => !d)}
            >
              <CalendarDays size={12} style={{ color: accentColor }} />
              <span className="flex-1 text-left">{mesesLabel}</span>
              <ChevronDown size={12} className={cn("transition-transform", showMesDropdown && "rotate-180")} />
            </button>
            {showMesDropdown && <MesDropdownPortal
              btnRef={mesBtnRef}
              meses={mesesDisponiveis}
              selecionados={mesesSelecionados}
              mesAtual={getMesAtual()}
              accentColor={accentColor}
              onSelect={v => { toggleMes(v); setShowMesDropdown(false); }}
              onClose={() => setShowMesDropdown(false)}
            />}
          </div>
        </div>

        {/* Linha 2: Referência + Favoritas + Carregar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Referência</span>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            <button
              className={cn("inline-flex items-center gap-1.5 px-3 py-1 transition-all", refMode === 'media6' ? "text-white" : "text-muted-foreground hover:bg-black/5")}
              style={refMode === 'media6' ? { background: accentColor } : {}}
              onClick={() => setRefMode('media6')}
            >
              <BarChart2 size={11} /> Média 6m
            </button>
            <button
              className={cn("inline-flex items-center gap-1.5 px-3 py-1 border-l border-border transition-all", refMode === 'ultimomes' ? "text-white" : "text-muted-foreground hover:bg-black/5")}
              style={refMode === 'ultimomes' ? { background: accentColor } : {}}
              onClick={() => setRefMode('ultimomes')}
            >
              <Clock size={11} /> Último mês
            </button>
          </div>

          <div className="w-px h-5 bg-border/60" />

          <span className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Favoritas</span>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            <button
              className={cn("inline-flex items-center gap-1.5 px-3 py-1 transition-all", !apenasF ? "text-white" : "text-muted-foreground hover:bg-black/5")}
              style={!apenasF ? { background: accentColor } : {}}
              onClick={() => setApenasF(false)}
            >
              <Check size={11} /> Todos
            </button>
            <button
              disabled={!temFavoritos}
              className={cn("inline-flex items-center gap-1.5 px-3 py-1 border-l border-border transition-all disabled:opacity-40 disabled:cursor-not-allowed", apenasF ? "text-white" : "text-muted-foreground hover:bg-black/5")}
              style={apenasF ? { background: '#f59e0b' } : {}}
              onClick={() => setApenasF(true)}
            >
              <Star size={11} /> Com ★
            </button>
          </div>

          <div className="ml-auto">
            <Button onClick={carregarDados} disabled={!canLoad || loadingMedias} size="sm" className="gap-1.5 h-8 text-xs" style={{ background: accentColor, opacity: canLoad ? 1 : 0.5 }}>
              {loadingMedias ? <><RefreshCw size={12} className="animate-spin" /> Carregando...</> : <><BarChart3 size={12} /> Carregar</>}
            </Button>
          </div>
        </div>

      </Card>

      {/* Loading */}
      {loadingMedias && (
        <div className="flex flex-col items-center justify-center h-[400px] gap-4">
          <div className="w-11 h-11 rounded-full border-[3px] border-primary/20 animate-spin" style={{ borderTopColor: accentColor }} />
          <p className="text-muted-foreground">Carregando plano de contas e médias históricas...</p>
        </div>
      )}

      {/* Content */}
      {tabelaVisivel && !loadingMedias && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-5 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
            {[
              { icon: <TrendingUp size={19} />, color: `${accentColor}22`, textColor: accentColor,      label: 'Média 6 Meses',   value: fmt(totalMedia) },
              { icon: <Target size={19} />,     color: 'rgba(16,185,129,0.15)', textColor: '#059669',   label: 'Total Planejado', value: fmt(totalPlanejado) },
              {
                icon: variacaoTotal >= 0 ? <Plus size={19} /> : <Minus size={19} />,
                color: variacaoTotal >= 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                textColor: variacaoTotal >= 0 ? '#dc2626' : '#059669',
                label: 'Variação vs Média',
                value: `${variacaoTotal >= 0 ? '+' : ''}${fmt(variacaoTotal)}`,
              },
              { icon: <CalendarDays size={19} />, color: 'rgba(245,158,11,0.15)', textColor: '#d97706', label: 'Mês · Unidade', value: `${mesesSelecionados.length} · ${activeUnidade ? activeUnidade.nome : 'Todas'}` },
            ].map((c, i) => (
              <Card key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: c.color, color: c.textColor }}>{c.icon}</div>
                <div>
                  <p className="text-[0.68rem] text-muted-foreground font-semibold uppercase tracking-[0.08em] mb-0.5">{c.label}</p>
                  <p className="text-[1.2rem] font-bold tabular-nums" style={{ color: c.textColor }}>{c.value}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* Month tags + Copiar Valores */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">Planejando para:</span>
            {mesesSelecionados.map(m => (
              <span key={m} className="inline-flex items-center px-3 py-1 rounded-full border text-[0.78rem] font-semibold" style={{ background: `${accentColor}18`, color: accentColor, borderColor: `${accentColor}44` }}>
                {mesesDisponiveis.find(x => x.value === m)?.label || m}
              </span>
            ))}
            <button
              onClick={copiarMesAnterior}
              disabled={copiando}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-300 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 hover:border-slate-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed ml-1"
            >
              {copiando
                ? <><RefreshCw size={11} className="animate-spin" /> Copiando...</>
                : <><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar Valores do Mês Anterior</>}
            </button>
          </div>

          {/* Tree table */}
          <Card className="overflow-hidden">
            <div className="flex justify-between items-center px-6 py-4 border-b border-border/50 flex-wrap gap-3">
              <h2 className="text-base font-bold flex items-center gap-2">
                <BarChart3 size={17} style={{ color: accentColor }} />
                Planejamento por Grupo
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/15">
                  {filteredTree.length} grupo{filteredTree.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input placeholder="Pesquisar grupo / despesa..." value={searchCat} onChange={e => setSearchCat(e.target.value)} className="pl-9 h-9 text-sm min-w-[260px]" />
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="min-w-[300px] text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Grupo / Sub-grupo / Despesa
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{refMode === 'media6' ? 'Média 6 meses' : 'Último mês'}</TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500 min-w-[200px]">Valor Planejado</TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Variação</TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 min-w-[200px]">Observação</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredTree.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                      {searchCat ? `Nenhum grupo encontrado para "${searchCat}".` : 'Nenhum dado disponível.'}
                    </TableCell>
                  </TableRow>
                )}

                {filteredTree.map(grupo => {
                  const isGrupoOpen   = !collapsedGrupos.has(grupo.key);
                  // Valor planejado do grupo: sempre do input do grupo (todos têm MoedaInput)
                  const grupoValor    = valores.get(grupo.key)?.valor ?? 0;
                  const grupoVariacao = grupoValor - grupo.media;

                  return (
                    <TableRowGroup key={grupo.key}>
                      {/* ── Linha do grupo ── */}
                      <TableRow
                        className="bg-slate-100 hover:bg-slate-100/90 border-t-2 border-border/40 cursor-pointer select-none"
                        onClick={() => toggleGrupo(grupo.key)}
                      >
                        {/* Nome */}
                        <TableCell className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white border border-border/60 shadow-sm flex-shrink-0">
                              <ChevronDown size={13} className={cn("text-slate-500 transition-transform duration-200", !isGrupoOpen && "-rotate-90")} />
                            </div>
                            {isGrupoOpen
                              ? <FolderOpen  size={15} className={cn("flex-shrink-0", grupo.hasSubs ? "text-blue-500" : "text-slate-500")} />
                              : <FolderClosed size={15} className={cn("flex-shrink-0", grupo.hasSubs ? "text-blue-500" : "text-slate-500")} />}
                            <span className="font-bold text-sm text-slate-800 uppercase tracking-wide">{grupo.label}</span>
                            {grupo.hasSubs && (
                              <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.62rem] font-bold uppercase tracking-wide bg-blue-50 text-blue-600 border border-blue-200 flex-shrink-0">
                                <Tag size={9} />
                                {grupo.subgrupos.length} sub
                              </span>
                            )}
                          </div>
                        </TableCell>
                        {/* Média */}
                        <TableCell className="text-right text-slate-600 tabular-nums font-medium text-sm py-3">
                          {fmt(grupo.media)}
                        </TableCell>
                        {/* Valor planejado — todos os grupos têm input */}
                        <TableCell className="text-right py-3 pr-5">
                          <MoedaInput
                            valor={valores.get(grupo.key)?.valor ?? 0}
                            inputRef={el => { if (el) inputRefs.current.set(grupo.key, el); }}
                            onChange={n => atualizarValor(grupo.key, String(n))}
                            onEnter={() => {}}
                          />
                        </TableCell>
                        {/* Variação */}
                        <TableCell className="text-right py-3">
                          <span className={cn("text-sm font-semibold tabular-nums", grupoVariacao === 0 ? 'text-muted-foreground' : grupoVariacao > 0 ? 'text-red-600' : 'text-emerald-700')}>
                            {grupoVariacao >= 0 ? '+' : ''}{fmt(grupoVariacao)}
                          </span>
                        </TableCell>
                        {/* Obs */}
                        <TableCell className="py-3">
                          <input
                            type="text"
                            className="w-full bg-white/60 border border-transparent rounded-lg px-2.5 py-1.5 text-slate-600 text-sm outline-none focus:border-border focus:bg-white transition-all placeholder:text-slate-400/50"
                            placeholder="Observação..."
                            value={valores.get(grupo.key)?.obs || ''}
                            onChange={e => atualizarObs(grupo.key, e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                        </TableCell>
                      </TableRow>

                      {isGrupoOpen && (
                        <>
                          {/* ── Sub-grupos ── */}
                          {grupo.subgrupos.map(sub => {
                            const isSubOpen    = !collapsedSubgrupos.has(sub.key);
                            return (
                              <TableRowGroup key={sub.key}>
                                {/* Sub-grupo header row — somente leitura */}
                                <TableRow
                                  className="bg-slate-50/70 hover:bg-slate-50 cursor-pointer select-none"
                                  onClick={() => toggleSubgrupo(sub.key)}
                                >
                                  <TableCell className="py-2.5 pl-10 pr-4">
                                    <div className="flex items-center gap-2">
                                      <ChevronDown size={13} className={cn("text-slate-400 transition-transform duration-200 flex-shrink-0", !isSubOpen && "-rotate-90")} />
                                      <Tag size={13} className="text-slate-400 flex-shrink-0" />
                                      <span className="text-sm font-semibold text-slate-600">{sub.label}</span>
                                      <span className="text-xs text-muted-foreground ml-1">({sub.despesas.length})</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right text-slate-500 tabular-nums text-sm py-2.5">
                                    {fmt(sub.media)}
                                  </TableCell>
                                  <TableCell className="text-right py-2.5 pr-5">
                                    <span className="text-xs text-slate-400">—</span>
                                  </TableCell>
                                  <TableCell className="py-2.5" />
                                  <TableCell className="py-2.5" />
                                </TableRow>

                                {/* Despesas do sub-grupo */}
                                {isSubOpen && sub.despesas.map(despesa => (
                                  <TableRow key={despesa.nome} className="hover:bg-slate-50/40 transition-colors">
                                    <TableCell className="py-2 pl-[3.75rem] pr-4">
                                      <span className="text-sm text-slate-500">{despesa.nome}</span>
                                    </TableCell>
                                    <TableCell className="text-right text-slate-400 tabular-nums text-sm py-2">
                                      {fmt(despesa.media)}
                                    </TableCell>
                                    <TableCell className="text-right py-2 pr-5">
                                      <span className="text-xs text-slate-400">—</span>
                                    </TableCell>
                                    <TableCell className="py-2" />
                                    <TableCell className="py-2" />
                                  </TableRow>
                                ))}
                              </TableRowGroup>
                            );
                          })}

                          {/* ── Despesas diretas (grupo sem sub-grupos) ── */}
                          {grupo.despesasDiretas.map(despesa => (
                            <TableRow key={despesa.nome} className="hover:bg-slate-50/40 transition-colors">
                              <TableCell className="py-2 pl-10 pr-4">
                                <span className="text-sm text-slate-500">{despesa.nome}</span>
                              </TableCell>
                              <TableCell className="text-right text-slate-400 tabular-nums text-sm py-2">
                                {fmt(despesa.media)}
                              </TableCell>
                              <TableCell className="text-right py-2 pr-5">
                                <span className="text-xs text-slate-400">—</span>
                              </TableCell>
                              <TableCell className="py-2" />
                              <TableCell className="py-2" />
                            </TableRow>
                          ))}
                        </>
                      )}
                    </TableRowGroup>
                  );
                })}
              </TableBody>

              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">TOTAL GERAL</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{fmt(totalMedia)}</TableCell>
                  <TableCell className="text-right pr-5"><strong className="text-emerald-700 tabular-nums">{fmt(totalPlanejado)}</strong></TableCell>
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
            {saveStatus === 'ok'    && <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 size={14} /> Planejamento salvo!</span>}
            {saveStatus === 'error' && <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200"><AlertCircle size={14} /> {erroMsg || 'Erro ao salvar'}</span>}
            <Button onClick={salvar} disabled={saving} className="gap-2" style={{ background: accentColor }}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Salvando...' : 'Salvar Planejamento'}
            </Button>
          </div>
        </>
      )}

      {tabelaVisivel && !loadingMedias && treeData.length === 0 && (
        <div className="flex flex-col items-center justify-center mt-8 gap-4 text-center py-20">
          <BarChart3 size={48} className="text-muted-foreground/40" />
          <h3 className="text-xl font-bold">Sem plano de contas</h3>
          <p className="text-muted-foreground text-sm">Não foi encontrado plano de contas para as unidades selecionadas.</p>
        </div>
      )}

      {!tabelaVisivel && !loadingMedias && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: `${accentColor}15` }}>
            <Target size={40} style={{ color: accentColor, opacity: 0.7 }} />
          </div>
          <h3 className="text-[1.3rem] font-bold">Selecione o mês</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Escolha o mês que deseja planejar e clique em <strong>Carregar Planejamento</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Helper: fragment wrapper para grupos/sub-grupos ───────────────────────────
function TableRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── Mes Dropdown via Portal (evita overflow:hidden do Card) ──────────────────
function MesDropdownPortal({ btnRef, meses, selecionados, mesAtual, accentColor, onSelect, onClose }: {
  btnRef: React.RefObject<HTMLButtonElement | null>;
  meses: { value: string; label: string }[];
  selecionados: string[];
  mesAtual: string;
  accentColor: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [btnRef]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] bg-white border border-border rounded-xl p-1.5 shadow-2xl"
        style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 200) }}
      >
        {meses.map(m => {
          const isSelected = selecionados.includes(m.value);
          const isCurrent  = m.value === mesAtual;
          return (
            <button key={m.value}
              className={cn("flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs text-left transition-all", isSelected ? "font-semibold" : "text-muted-foreground hover:bg-black/5 hover:text-foreground")}
              style={isSelected ? { background: `${accentColor}18`, color: accentColor } : {}}
              onClick={() => onSelect(m.value)}
            >
              {isSelected
                ? <CheckCircle2 size={11} className="flex-shrink-0" />
                : <span className="w-3 h-3 rounded-full border border-border flex-shrink-0" />}
              {m.label}
              {isCurrent && <span className="ml-auto text-[0.6rem] font-bold px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Atual</span>}
            </button>
          );
        })}
      </div>
    </>,
    document.body
  );
}

// ── Custom Currency Input ─────────────────────────────────────────────────────
// Mascara estilo "centavos": digitos preenchem da direita p/ esquerda,
// virgula decimal sempre fixa. Ex: digitar "1234" -> "12,34".
function MoedaInput({ valor, onChange, onEnter, inputRef }: {
  valor: number; onChange: (n: number) => void; onEnter: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const fmtNum = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const [str, setStr] = useState(fmtNum(valor));

  useEffect(() => {
    if (Math.abs(parseMoeda(str) - valor) > 0.001) setStr(fmtNum(valor));
  }, [valor]); // eslint-disable-line

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (!digits) {
      setStr(fmtNum(0));
      onChange(0);
      return;
    }
    // Limita a ate 13 digitos (bilhoes com centavos) p/ nao estourar precisao
    const clamped = digits.slice(0, 13);
    const n = parseInt(clamped, 10) / 100;
    setStr(fmtNum(n));
    onChange(n);
  };

  return (
    <div className="inline-flex items-center gap-1.5 bg-white border border-border rounded-lg px-2.5 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition-all">
      <span className="text-xs text-muted-foreground font-semibold flex-shrink-0">R$</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        className="bg-transparent border-none outline-none text-foreground font-semibold tabular-nums text-sm w-[110px] text-right"
        value={str}
        onChange={handleChange}
        onKeyDown={e => { if (e.key === 'Enter') { onEnter(); } }}
        onFocus={e => e.target.select()}
      />
    </div>
  );
}
