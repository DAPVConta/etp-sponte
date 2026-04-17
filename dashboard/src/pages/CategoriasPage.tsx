import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  RefreshCw, AlertCircle, Wifi, WifiOff, Search, Star, X,
  ChevronDown, ChevronRight, FolderOpen, FolderClosed, Tag,
} from 'lucide-react';
import type { Unidade, CategoriaDespesa } from '../types';
import { SyncAPI } from '../api/sync';
import { FavoritosAPI } from '../api/favoritos';
import { useAuth } from '../contexts/AuthContext';
import { PlanoContasAPI, type PlanoContasItem } from '../api/planoContas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── Utilities ────────────────────────────────────────────────────────────────
/** Normaliza para comparação case-insensitive sem acentos */
const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// ── XML Parser ───────────────────────────────────────────────────────────────
const getXMLText = (node: Element, ...tags: string[]): string => {
  for (const tag of tags) {
    const content = node.getElementsByTagName(tag)[0]?.textContent?.trim();
    if (content) return content;
  }
  return '';
};

const parseCategoriasDespesasXML = (xmlString: string): CategoriaDespesa[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) return [];
  const result: CategoriaDespesa[] = [];
  for (const node of Array.from(xmlDoc.getElementsByTagName('Categorias'))) {
    const id = parseInt(node.getElementsByTagName('CategoriaID')[0]?.textContent?.trim() || '0', 10);
    const nome = node.getElementsByTagName('Nome')[0]?.textContent?.trim() || '';
    if (id > 0 && nome) {
      const grupo    = getXMLText(node, 'Grupo', 'GrupoNome', 'NomeGrupo', 'GrupoDespesa', 'Classificacao');
      const subgrupo = getXMLText(node, 'SubGrupo', 'Subgrupo', 'SubGrupoNome', 'NomeSubgrupo', 'SubGrupoDespesa');
      result.push({ categoriaID: id, nome, grupo: grupo || undefined, subgrupo: subgrupo || undefined });
    }
  }
  return result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
};

// ── Types ────────────────────────────────────────────────────────────────────
interface Props { unidades: Unidade[]; accentColor: string; }

interface UnidadeResult {
  unidade: Unidade;
  categorias: CategoriaDespesa[];
  loading: boolean;
  error: string;
  source: 'api' | 'error' | null;
}

interface SubgrupoEntry {
  key: string;
  label: string;
  nomes: string[];
}

interface GrupoEntry {
  key: string;
  label: string;
  subgrupos: SubgrupoEntry[];
  showSubs: boolean;   // only when subgrupo labels are non-empty
  totalCats: number;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function CategoriasPage({ unidades, accentColor }: Props) {
  const { user } = useAuth();
  const [results, setResults]               = useState<UnidadeResult[]>([]);
  const [search, setSearch]                 = useState('');
  const [lastSync, setLastSync]             = useState<Date | null>(null);
  const [favoritos, setFavoritos]           = useState<Set<string>>(new Set());
  const [loadingFav, setLoadingFav]         = useState<Set<string>>(new Set());
  const [mostraApenasF, setMostraApenasF]   = useState(false);
  const [erroFav, setErroFav]               = useState('');
  const [collapsedGrupos, setCollapsedGrupos]       = useState<Set<string>>(new Set());
  const [collapsedSubgrupos, setCollapsedSubgrupos] = useState<Set<string>>(new Set());
  const [planoContas, setPlanoContas]               = useState<Map<string, PlanoContasItem[]>>(new Map());

  // ── Favoritos ──────────────────────────────────────────────────────────────
  useEffect(() => {
    FavoritosAPI.listar()
      .then(lista => setFavoritos(new Set(lista)))
      .catch(err => setErroFav(`Tabela de favoritos não encontrada. Erro: ${err.message}`));
  }, []);

  // ── Plano de contas ────────────────────────────────────────────────────────
  useEffect(() => {
    if (unidades.length === 0) return;
    Promise.all(
      unidades.map(u =>
        PlanoContasAPI.listarPorUnidade(u.id)
          .then(items => ({ unidadeId: u.id, items }))
          .catch(() => ({ unidadeId: u.id, items: [] as PlanoContasItem[] }))
      )
    ).then(resultados => {
      const map = new Map<string, PlanoContasItem[]>();
      resultados.forEach(r => map.set(r.unidadeId, r.items));
      setPlanoContas(map);
    });
  }, [unidades]);

  const toggleFavorito = useCallback(async (categoria: string) => {
    setErroFav('');
    const eraFav = favoritos.has(categoria);
    setFavoritos(prev => { const n = new Set(prev); eraFav ? n.delete(categoria) : n.add(categoria); return n; });
    setLoadingFav(prev => { const s = new Set(prev); s.add(categoria); return s; });
    try {
      const empresaId = user?.empresaId ?? '';
      const isFav = await FavoritosAPI.toggle(categoria, empresaId);
      setFavoritos(prev => { const n = new Set(prev); isFav ? n.add(categoria) : n.delete(categoria); return n; });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setFavoritos(prev => { const n = new Set(prev); eraFav ? n.add(categoria) : n.delete(categoria); return n; });
      setErroFav(e?.message?.includes('does not exist')
        ? 'Tabela não existe. Execute no Supabase: CREATE TABLE etp_categorias_favoritas ...'
        : `Erro ao salvar favorito: ${e?.message}`);
    } finally {
      setLoadingFav(prev => { const s = new Set(prev); s.delete(categoria); return s; });
    }
  }, [favoritos]);

  // ── Fetch / Sync ───────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (unidades.length === 0) return;
    setResults(unidades.map(u => ({ unidade: u, categorias: [], loading: true, error: '', source: null })));
    const all = await Promise.all(unidades.map(async (u): Promise<UnidadeResult> => {
      try {
        const res = await axios.get('/api-sponte/WSAPIEdu.asmx/GetCategoriasDespesas', {
          params: { nCodigoCliente: u.codigoSponte, sToken: u.tokenSponte },
          timeout: 20000,
        });
        const categorias = parseCategoriasDespesasXML(res.data);
        try {
          await SyncAPI.syncCategorias(u.id, categorias);
          await SyncAPI.logSync(u.id, 'categorias', 'sucesso', categorias.length);
        } catch (syncErr) {
          await SyncAPI.logSync(u.id, 'categorias', 'erro', 0, String(syncErr));
        }
        return { unidade: u, categorias, loading: false, error: '', source: 'api' };
      } catch (e: unknown) {
        const err = e as { message?: string };
        return { unidade: u, categorias: [], loading: false, error: err?.message || 'Erro desconhecido', source: 'error' };
      }
    }));
    setResults(all);
    setLastSync(new Date());
  }, [unidades]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Merge plano de contas de todas as unidades (deduplica por id) ──────────
  const allPlanoItems = useMemo((): PlanoContasItem[] => {
    const items: PlanoContasItem[] = [];
    const seen = new Set<string>();
    for (const unitItems of planoContas.values()) {
      for (const item of unitItems) {
        const key = `${item.tipo}::${item.grupoNome ?? ''}::${item.subGrupoNome ?? ''}::${norm(item.nome)}`;
        if (!seen.has(key)) { seen.add(key); items.push(item); }
      }
    }
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [planoContas]);

  const despesasDoPlano = useMemo(
    () => allPlanoItems.filter(i => i.tipo === 'despesa'),
    [allPlanoItems]
  );

  // ── Fonte dos nomes de categorias: plano de contas (primário) ─────────────
  // Enquanto o plano não carregou, usa os nomes do Sponte como fallback temporário
  const uniqueCategories = useMemo((): string[] => {
    if (despesasDoPlano.length > 0) return despesasDoPlano.map(d => d.nome);
    return [...new Set(results.flatMap(r => r.categorias.map(c => c.nome)))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [despesasDoPlano, results]);

  const filteredCategories = useMemo(
    () => uniqueCategories.filter(c =>
      c.toLowerCase().includes(search.toLowerCase()) && (!mostraApenasF || favoritos.has(c))
    ),
    [uniqueCategories, search, mostraApenasF, favoritos]
  );

  // ── Build grouped tree 100% a partir do etp_plano_contas ──────────────────
  const groupedData = useMemo((): GrupoEntry[] => {
    if (allPlanoItems.length === 0) return [];

    const grupoRows    = allPlanoItems.filter(i => i.tipo === 'grupo');
    const subGrupoRows = allPlanoItems.filter(i => i.tipo === 'sub_grupo');

    return grupoRows.flatMap(grupo => {
      const subs     = subGrupoRows.filter(s => s.grupoNome === grupo.nome);
      const subgrupos: SubgrupoEntry[] = [];

      if (subs.length > 0) {
        // Grupo tem sub-grupos definidos
        for (const sub of subs) {
          const nomes = filteredCategories.filter(cat =>
            despesasDoPlano.some(d =>
              d.grupoNome === grupo.nome &&
              d.subGrupoNome === sub.nome &&
              norm(d.nome) === norm(cat)
            )
          );
          if (nomes.length > 0)
            subgrupos.push({ key: `${grupo.nome}::${sub.nome}`, label: sub.nome, nomes });
        }
        // Despesas do grupo sem sub-grupo (subGrupoNome nulo)
        const usadosEmSubs = new Set(subgrupos.flatMap(s => s.nomes));
        const semSub = filteredCategories.filter(cat =>
          !usadosEmSubs.has(cat) &&
          despesasDoPlano.some(d =>
            d.grupoNome === grupo.nome && !d.subGrupoNome && norm(d.nome) === norm(cat)
          )
        );
        if (semSub.length > 0)
          subgrupos.push({ key: `${grupo.nome}::`, label: '', nomes: semSub });
      } else {
        // Grupo sem sub-grupos: todas as despesas vão direto
        const nomes = filteredCategories.filter(cat =>
          despesasDoPlano.some(d =>
            d.grupoNome === grupo.nome && norm(d.nome) === norm(cat)
          )
        );
        if (nomes.length > 0)
          subgrupos.push({ key: `${grupo.nome}::`, label: '', nomes });
      }

      if (subgrupos.length === 0) return [];
      const totalCats = subgrupos.reduce((acc, s) => acc + s.nomes.length, 0);
      const showSubs  = subgrupos.some(s => s.label !== '');
      return [{ key: grupo.nome, label: grupo.nome, subgrupos, showSubs, totalCats }];
    });
  }, [filteredCategories, allPlanoItems, despesasDoPlano]);

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  const toggleGrupo = (key: string) =>
    setCollapsedGrupos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleSubgrupo = (key: string) =>
    setCollapsedSubgrupos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const colSpan = results.length + 2;
  const isLoading = results.some(r => r.loading);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">

      {/* ── Header ── */}
      <header className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1
            className="text-[1.75rem] font-extrabold tracking-tight"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
          >
            Categorias de Despesas
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm">
            {lastSync && <span className="text-muted-foreground text-xs">Sincronizado às {lastSync.toLocaleTimeString('pt-BR')}</span>}
            {favoritos.size > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-600 text-xs">
                <Star size={12} fill="#d97706" /> {favoritos.size} favorita{favoritos.size !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setMostraApenasF(v => !v)}
            className={cn(
              "gap-2 text-sm border-amber-400/40",
              mostraApenasF
                ? "bg-amber-50 text-amber-700 border-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.08)]"
                : "text-amber-600/80 hover:bg-amber-50/60"
            )}
          >
            <Star size={14} fill={mostraApenasF ? '#d97706' : 'none'} className="text-amber-500" />
            {mostraApenasF ? 'Apenas favoritas' : 'Favoritas'}
          </Button>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Filtrar categorias..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 min-w-[220px]"
            />
          </div>
          <Button
            onClick={fetchAll}
            disabled={isLoading}
            className="gap-2"
            style={{ background: accentColor, boxShadow: `0 4px 6px -1px ${accentColor}55` }}
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            Sincronizar
          </Button>
        </div>
      </header>

      {/* ── Favoritos error ── */}
      {erroFav && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700 text-sm mb-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><AlertCircle size={15} /><strong>Erro nos favoritos:</strong></div>
            <button onClick={() => setErroFav('')} className="text-red-400 hover:text-red-700 transition-colors"><X size={15} /></button>
          </div>
          <span className="text-xs break-all opacity-80">{erroFav}</span>
        </div>
      )}

      {/* ── Status por unidade ── */}
      <div className="grid grid-cols-4 gap-4 mb-6 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
        {results.map(r => (
          <Card key={r.unidade.id} className="flex items-center gap-4 px-5 py-4">
            <div className="w-[46px] h-[46px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${r.unidade.cor}22` }}>
              {r.loading
                ? <RefreshCw size={22} className="animate-spin" style={{ color: r.unidade.cor }} />
                : r.source === 'error'
                  ? <WifiOff size={22} className="text-red-600" />
                  : <Wifi size={22} style={{ color: r.unidade.cor }} />}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: r.unidade.cor }}>{r.unidade.nome}</p>
              {r.loading
                ? <p className="text-xs text-muted-foreground">Carregando...</p>
                : r.source === 'error'
                  ? <p className="text-xs text-red-600">Erro na API</p>
                  : <p className="text-sm font-semibold">{r.categorias.length} categorias</p>}
            </div>
          </Card>
        ))}
        {results.length === 0 && (
          <Card className="col-span-full text-center px-6 py-8 text-muted-foreground text-sm">
            Nenhuma unidade cadastrada. Acesse "Cadastro de Unidades" para adicionar.
          </Card>
        )}
      </div>

      {/* ── Tabela agrupada ── */}
      {results.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex justify-between items-center px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold">Categorias de Despesas por Unidade</h2>
              {groupedData.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {groupedData.length} grupo{groupedData.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/15">
              {filteredCategories.length} categorias {search && `(filtradas de ${uniqueCategories.length})`}
            </Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="w-11 text-center">
                  <Star size={13} className="text-amber-500 mx-auto" />
                </TableHead>
                <TableHead className="min-w-[240px] text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Categoria de Despesa
                </TableHead>
                {results.map(r => (
                  <TableHead key={r.unidade.id} className="text-center min-w-[120px]">
                    <span style={{ color: r.unidade.cor }} className="flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: r.unidade.cor }} />
                      <span className="text-xs font-semibold">{r.unidade.nome}</span>
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {groupedData.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-12">
                    {mostraApenasF
                      ? 'Nenhuma categoria favorita encontrada.'
                      : search
                        ? `Nenhuma categoria encontrada para "${search}".`
                        : 'Nenhuma categoria de despesas carregada.'}
                  </TableCell>
                </TableRow>
              )}

              {groupedData.map(({ key: grupKey, label: grupLabel, subgrupos, showSubs, totalCats }) => {
                const isGrupoOpen = !collapsedGrupos.has(grupKey);

                return (
                  <React.Fragment key={grupKey}>
                    {/* ── Linha do grupo ── */}
                    <TableRow
                      className="bg-slate-100 hover:bg-slate-100/90 border-t-2 border-border/40 cursor-pointer select-none"
                      onClick={() => toggleGrupo(grupKey)}
                    >
                      <TableCell colSpan={colSpan} className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white border border-border/60 shadow-sm flex-shrink-0">
                            <ChevronDown
                              size={13}
                              className={cn("text-slate-500 transition-transform duration-200", !isGrupoOpen && "-rotate-90")}
                            />
                          </div>
                          {isGrupoOpen
                            ? <FolderOpen  size={15} className="text-slate-500 flex-shrink-0" />
                            : <FolderClosed size={15} className="text-slate-500 flex-shrink-0" />}
                          <span className="font-bold text-sm text-slate-800 uppercase tracking-wide">
                            {grupLabel}
                          </span>
                          <Badge variant="secondary" className="ml-1 text-[0.65rem] px-1.5 py-0 h-5 text-slate-500">
                            {totalCats}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isGrupoOpen && subgrupos.map(({ key: subKey, label: subLabel, nomes }) => {
                      const isSubOpen = !collapsedSubgrupos.has(subKey);
                      const showSubRow = showSubs && subLabel !== '';

                      return (
                        <React.Fragment key={subKey}>
                          {/* ── Linha do subgrupo ── */}
                          {showSubRow && (
                            <TableRow
                              className="bg-slate-50/70 hover:bg-slate-50 cursor-pointer select-none"
                              onClick={() => toggleSubgrupo(subKey)}
                            >
                              <TableCell colSpan={colSpan} className="py-2 pl-10 pr-4">
                                <div className="flex items-center gap-2">
                                  <ChevronRight
                                    size={13}
                                    className={cn("text-slate-400 transition-transform duration-200 flex-shrink-0", isSubOpen && "rotate-90")}
                                  />
                                  <Tag size={13} className="text-slate-400 flex-shrink-0" />
                                  <span className="text-sm font-semibold text-slate-600">{subLabel}</span>
                                  <span className="ml-1 text-xs text-muted-foreground">({nomes.length})</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}

                          {/* ── Linhas de categorias ── */}
                          {(!showSubRow || isSubOpen) && nomes.map(nome => {
                            const isFav = favoritos.has(nome);
                            const isLoadingFav = loadingFav.has(nome);
                            const indent = showSubRow ? 'pl-[3.75rem]' : 'pl-10';

                            return (
                              <TableRow key={nome} className={cn("hover:bg-slate-50/60 transition-colors", isFav && 'bg-amber-50/40')}>
                                {/* Favorito */}
                                <TableCell className="text-center p-2 w-11">
                                  <button
                                    onClick={() => toggleFavorito(nome)}
                                    disabled={isLoadingFav}
                                    title={isFav ? 'Remover favorito' : 'Adicionar favorito'}
                                    className={cn(
                                      "w-8 h-8 rounded-lg border flex items-center justify-center transition-all mx-auto",
                                      isFav
                                        ? "bg-amber-50 border-amber-300 text-amber-600"
                                        : "bg-transparent border-transparent text-muted-foreground/30 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-500"
                                    )}
                                  >
                                    {isLoadingFav
                                      ? <RefreshCw size={13} className="animate-spin" />
                                      : <Star size={14} fill={isFav ? '#d97706' : 'none'} strokeWidth={isFav ? 0 : 1.5} />}
                                  </button>
                                </TableCell>

                                {/* Nome */}
                                <TableCell className={cn("font-medium max-w-[260px]", indent)}>
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="truncate text-sm text-slate-700">{nome}</span>
                                    {isFav && (
                                      <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide">
                                        ★ fav
                                      </span>
                                    )}
                                  </div>
                                </TableCell>

                                {/* Colunas por unidade */}
                                {results.map(r => {
                                  const catItem = r.categorias.find(c => norm(c.nome) === norm(nome));
                                  const planoItem = planoContas.get(r.unidade.id)?.find(p => p.tipo === 'despesa' && norm(p.nome) === norm(nome));
                                  return (
                                    <TableCell key={r.unidade.id} className="text-center">
                                      {r.loading
                                        ? <span className="text-muted-foreground text-xs">...</span>
                                        : catItem
                                          ? (
                                            <Badge
                                              className="text-[0.68rem] px-2 py-0.5 font-semibold"
                                              style={{ background: `${r.unidade.cor}18`, color: r.unidade.cor, border: `1px solid ${r.unidade.cor}40` }}
                                            >
                                              ✓ ID {catItem.categoriaID}
                                            </Badge>
                                          )
                                          : planoItem
                                            ? (
                                              <Badge
                                                className="text-[0.68rem] px-2 py-0.5 font-semibold"
                                                style={{ background: `${r.unidade.cor}10`, color: `${r.unidade.cor}bb`, border: `1px solid ${r.unidade.cor}25` }}
                                              >
                                                ✓ Plano
                                              </Badge>
                                            )
                                            : <span className="text-border text-xs">—</span>}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>

          {/* Erros por unidade */}
          {results.filter(r => r.source === 'error').map(r => (
            <div key={r.unidade.id} className="flex items-center gap-3 mx-6 mb-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              <AlertCircle size={15} />
              <span><strong>{r.unidade.nome}:</strong> {r.error}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
