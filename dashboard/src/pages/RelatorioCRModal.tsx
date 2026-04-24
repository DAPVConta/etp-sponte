import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, RefreshCw, AlertCircle } from 'lucide-react';
import type { Unidade } from '../types';
import { ContasReceberAPI, type LancamentoCR } from '../api/contasReceber';
import { PlanoContasAPI, type PlanoContasItem } from '../api/planoContas';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const norm = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v);
}
function fmtDateBR(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function mesLabel(mes: string) {
  if (!mes) return '';
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES_PT[m - 1]} ${ano}`;
}

interface Props {
  unidade: Unidade;
  mes: string; // YYYY-MM
  accentColor: string;
  onClose: () => void;
}

interface LinhaReceita {
  nome: string;
  lancamentos: LancamentoCR[];
  total: number;
}
interface LinhaSubgrupo {
  nome: string;
  receitas: LinhaReceita[];
  total: number;
}
interface LinhaGrupo {
  nome: string;
  subgrupos: LinhaSubgrupo[];
  receitasDiretas: LinhaReceita[];
  total: number;
}

export default function RelatorioCRModal({ unidade, mes, accentColor, onClose }: Props) {
  const [lancamentos, setLancamentos] = useState<LancamentoCR[]>([]);
  const [plano, setPlano]             = useState<PlanoContasItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [erro, setErro]               = useState('');

  useEffect(() => {
    let cancelado = false;
    (async () => {
      setLoading(true); setErro('');
      try {
        const [lanc, pc] = await Promise.all([
          ContasReceberAPI.listarLancamentos({ unidadeIds: [unidade.id], mes }),
          PlanoContasAPI.listarPorUnidade(unidade.id).catch(() => [] as PlanoContasItem[]),
        ]);
        if (cancelado) return;
        // Somente receitas efetivamente recebidas (com data de pagamento)
        setLancamentos(lanc.filter(l => l.dataPagamento));
        setPlano(pc);
      } catch (e: unknown) {
        const err = e as { message?: string };
        if (!cancelado) setErro(err?.message || 'Erro ao carregar relatório');
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [unidade.id, mes]);

  const valorDoLancamento = (l: LancamentoCR) => l.valorPago > 0 ? l.valorPago : l.valorParcela;

  // Agrupamento: grupo > subgrupo > receita > lançamentos
  const arvore: LinhaGrupo[] = useMemo(() => {
    if (!plano.length) {
      const porCat = new Map<string, LancamentoCR[]>();
      for (const l of lancamentos) {
        const k = l.categoria || '(Sem categoria)';
        if (!porCat.has(k)) porCat.set(k, []);
        porCat.get(k)!.push(l);
      }
      const receitas: LinhaReceita[] = [...porCat.entries()].map(([nome, lanc]) => ({
        nome, lancamentos: lanc, total: lanc.reduce((s, x) => s + valorDoLancamento(x), 0),
      }));
      receitas.sort((a, b) => a.nome.localeCompare(b.nome));
      return [{
        nome: 'Sem plano de contas',
        subgrupos: [],
        receitasDiretas: receitas,
        total: receitas.reduce((s, d) => s + d.total, 0),
      }];
    }

    const receitasPlano = plano.filter(p => p.tipo === 'receita');
    const classif = new Map<string, { grupo: string; subgrupo: string | null; nome: string }>();
    for (const d of receitasPlano) {
      classif.set(norm(d.nome), {
        grupo: d.grupoNome || 'Sem grupo',
        subgrupo: d.subGrupoNome || null,
        nome: d.nome,
      });
    }

    const gruposOrdem = plano.filter(p => p.tipo === 'grupo').sort((a, b) => a.sortOrder - b.sortOrder).map(p => p.nome);
    const subOrdem    = new Map<string, string[]>();
    for (const sg of plano.filter(p => p.tipo === 'sub_grupo').sort((a, b) => a.sortOrder - b.sortOrder)) {
      const g = sg.grupoNome || '';
      if (!subOrdem.has(g)) subOrdem.set(g, []);
      subOrdem.get(g)!.push(sg.nome);
    }
    const recOrdem = new Map<string, string[]>();
    for (const d of receitasPlano.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const k = `${d.grupoNome || ''}::${d.subGrupoNome || ''}`;
      if (!recOrdem.has(k)) recOrdem.set(k, []);
      recOrdem.get(k)!.push(d.nome);
    }

    const agg = new Map<string, Map<string, Map<string, LancamentoCR[]>>>();
    const categoriasSemClassif = new Map<string, LancamentoCR[]>();

    for (const l of lancamentos) {
      const c = classif.get(norm(l.categoria));
      if (!c) {
        const k = l.categoria || '(Sem categoria)';
        if (!categoriasSemClassif.has(k)) categoriasSemClassif.set(k, []);
        categoriasSemClassif.get(k)!.push(l);
        continue;
      }
      const g = c.grupo;
      const s = c.subgrupo || '';
      const d = c.nome;
      if (!agg.has(g)) agg.set(g, new Map());
      if (!agg.get(g)!.has(s)) agg.get(g)!.set(s, new Map());
      if (!agg.get(g)!.get(s)!.has(d)) agg.get(g)!.get(s)!.set(d, []);
      agg.get(g)!.get(s)!.get(d)!.push(l);
    }

    const todosGrupos = Array.from(new Set([...gruposOrdem, ...agg.keys()]));
    const arv: LinhaGrupo[] = [];
    for (const g of todosGrupos) {
      const byG = agg.get(g);
      if (!byG) continue;

      const subNames = Array.from(new Set([...(subOrdem.get(g) || []), ...Array.from(byG.keys()).filter(x => x !== '')]));
      const subgrupos: LinhaSubgrupo[] = [];
      for (const s of subNames) {
        const byS = byG.get(s);
        if (!byS) continue;
        const recNames = Array.from(new Set([...(recOrdem.get(`${g}::${s}`) || []), ...byS.keys()]));
        const receitas: LinhaReceita[] = [];
        for (const d of recNames) {
          const lanc = byS.get(d);
          if (!lanc || lanc.length === 0) continue;
          receitas.push({ nome: d, lancamentos: lanc, total: lanc.reduce((sum, x) => sum + valorDoLancamento(x), 0) });
        }
        if (receitas.length) subgrupos.push({ nome: s, receitas, total: receitas.reduce((sum, d) => sum + d.total, 0) });
      }

      const bySemSub = byG.get('');
      const receitasDiretas: LinhaReceita[] = [];
      if (bySemSub) {
        const recNames = Array.from(new Set([...(recOrdem.get(`${g}::`) || []), ...bySemSub.keys()]));
        for (const d of recNames) {
          const lanc = bySemSub.get(d);
          if (!lanc || lanc.length === 0) continue;
          receitasDiretas.push({ nome: d, lancamentos: lanc, total: lanc.reduce((sum, x) => sum + valorDoLancamento(x), 0) });
        }
      }

      const total = subgrupos.reduce((s, x) => s + x.total, 0) + receitasDiretas.reduce((s, x) => s + x.total, 0);
      if (total > 0 || subgrupos.length || receitasDiretas.length) {
        arv.push({ nome: g, subgrupos, receitasDiretas, total });
      }
    }

    if (categoriasSemClassif.size) {
      const receitas: LinhaReceita[] = [...categoriasSemClassif.entries()]
        .map(([nome, lanc]) => ({ nome, lancamentos: lanc, total: lanc.reduce((s, x) => s + valorDoLancamento(x), 0) }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      arv.push({
        nome: '(Sem classificação no plano de contas)',
        subgrupos: [],
        receitasDiretas: receitas,
        total: receitas.reduce((s, d) => s + d.total, 0),
      });
    }

    return arv;
  }, [plano, lancamentos]);

  const totalGeral = arvore.reduce((s, g) => s + g.total, 0);
  const qtdLancamentos = lancamentos.length;

  return createPortal(
    <>
      <style>{`
        @media print {
          body > *:not([data-print-root]) { display: none !important; }
          [data-print-root] {
            position: static !important;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
          }
          [data-print-root] .no-print { display: none !important; }
          [data-print-root] .print-area {
            position: static !important;
            inset: auto !important;
            overflow: visible !important;
            background: white !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          @page { size: A4; margin: 14mm 12mm; }
        }
      `}</style>

      <div
        data-print-root
        className="fixed inset-0 z-[9999] bg-black/40 flex items-start justify-center overflow-auto"
      >
        <div className="print-area bg-white w-[210mm] min-h-[297mm] my-6 mx-4 shadow-2xl p-10 relative">
          {/* Toolbar */}
          <div className="no-print flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Pré-visualização do relatório</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold shadow-sm hover:brightness-95 transition-all"
                style={{ background: accentColor }}
              >
                <Printer size={13} /> Imprimir
              </button>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-all"
              >
                <X size={13} /> Fechar
              </button>
            </div>
          </div>

          {/* Cabeçalho do relatório */}
          <header className="mb-6 pb-4 border-b-2" style={{ borderColor: accentColor }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: accentColor }}>
                  Relatório de Receitas
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  <strong>{unidade.nome}</strong> · {mes ? mesLabel(mes) : 'Todos os meses'}
                </p>
              </div>
              <div className="text-right text-[0.72rem] text-slate-500">
                <p>Emitido em {new Date().toLocaleDateString('pt-BR')}</p>
                <p>{qtdLancamentos} lançamento{qtdLancamentos !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </header>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
              <RefreshCw size={14} className="animate-spin" /> Carregando relatório...
            </div>
          )}

          {erro && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              <AlertCircle size={16} /><span>{erro}</span>
            </div>
          )}

          {!loading && !erro && arvore.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-10">Nenhuma receita recebida no período.</p>
          )}

          {!loading && !erro && arvore.length > 0 && (
            <>
              <table className="w-full border-collapse text-[0.78rem]">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-300">
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider text-[0.65rem] text-slate-600">Grupo / Sub-grupo / Receita</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-[0.65rem] text-slate-600 whitespace-nowrap w-[120px]">Valor Recebido</th>
                  </tr>
                </thead>
                <tbody>
                  {arvore.map(g => (
                    <GrupoBloco key={g.nome} grupo={g} accentColor={accentColor} totalGeral={totalGeral} />
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: accentColor }}>
                    <td className="px-3 py-2.5 font-extrabold uppercase tracking-wider text-white text-[0.75rem]">TOTAL GERAL</td>
                    <td className="px-3 py-2.5 text-right font-extrabold tabular-nums text-white">{fmtBRL(totalGeral)}</td>
                  </tr>
                </tfoot>
              </table>

              <footer className="mt-6 pt-3 border-t border-slate-200 text-[0.68rem] text-slate-400 flex justify-between">
                <span>ETP — {unidade.nome}</span>
                <span>Página 1</span>
              </footer>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Bloco de grupo ──────────────────────────────────────────────────────────
function GrupoBloco({ grupo, accentColor, totalGeral }: { grupo: LinhaGrupo; accentColor: string; totalGeral: number }) {
  const pct = totalGeral > 0 ? (grupo.total / totalGeral) * 100 : 0;
  return (
    <>
      <tr className="border-t-2" style={{ borderColor: `${accentColor}44`, background: `${accentColor}12` }}>
        <td className="px-3 py-2 font-bold uppercase tracking-wide text-[0.72rem]" style={{ color: accentColor }}>
          {grupo.nome}
          <span className="ml-2 text-[0.62rem] font-semibold text-slate-500 normal-case tracking-normal">({pct.toFixed(1)}%)</span>
        </td>
        <td className="px-3 py-2 text-right font-extrabold tabular-nums text-[0.78rem]" style={{ color: accentColor }}>
          {fmtBRL(grupo.total)}
        </td>
      </tr>

      {grupo.subgrupos.map(sg => (
        <SubgrupoBloco key={sg.nome} subgrupo={sg} />
      ))}

      {grupo.receitasDiretas.map(d => (
        <ReceitaLinha key={d.nome} receita={d} indent="pl-8" />
      ))}
    </>
  );
}

function SubgrupoBloco({ subgrupo }: { subgrupo: LinhaSubgrupo }) {
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50">
        <td className="px-3 py-1.5 pl-6 font-semibold text-slate-700 text-[0.72rem]">
          {subgrupo.nome}
        </td>
        <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-700">{fmtBRL(subgrupo.total)}</td>
      </tr>
      {subgrupo.receitas.map(d => (
        <ReceitaLinha key={d.nome} receita={d} indent="pl-10" />
      ))}
    </>
  );
}

function ReceitaLinha({ receita, indent }: { receita: LinhaReceita; indent: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <tr
        className="border-t border-slate-100 hover:bg-slate-50/40 cursor-pointer no-print-toggle"
        onClick={() => setAberto(a => !a)}
      >
        <td className={`${indent} pr-3 py-1.5 text-slate-600`}>
          <span className="inline-flex items-center gap-1.5">
            <span className="no-print text-[0.62rem] text-slate-400 w-3 inline-block">{aberto ? '▾' : '▸'}</span>
            {receita.nome}
            <span className="text-[0.62rem] text-slate-400 ml-1">({receita.lancamentos.length})</span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtBRL(receita.total)}</td>
      </tr>

      {aberto && receita.lancamentos.map((l, i) => (
        <tr key={`${l.contaReceberId}-${l.numeroParcela}-${i}`} className="bg-slate-50/40">
          <td className={`${indent} pl-14 pr-3 py-1 text-[0.7rem] text-slate-500`}>
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{fmtDateBR(l.dataPagamento)}</span>
              <span className="text-slate-400">·</span>
              <span className="truncate">{l.sacado || '—'}</span>
            </span>
          </td>
          <td className="px-3 py-1 text-right tabular-nums text-[0.7rem] text-slate-500">{fmtBRL(l.valorPago > 0 ? l.valorPago : l.valorParcela)}</td>
        </tr>
      ))}
    </>
  );
}
