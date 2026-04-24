import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  Settings, RefreshCw, Check, ChevronDown, AlertCircle,
  CheckCircle2, Clock, MinusCircle, Upload,
} from 'lucide-react';
import { SyncAPI } from '@/api/sync';
import { SyncDiasAPI, type SyncDia } from '@/api/syncDias';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Unidade, ParcelaPagar, ParcelaReceber } from '@/types';
import ImportarCaixaModal from '@/components/ImportarCaixaModal';
import { parseParcelasReceberXML } from '@/lib/sponteXmlParser';

type SyncType = 'cp' | 'cr';

// ── XML Parser (mesmo do DashboardPage) ─────────────────────────
const PARCELA_FIELDS = [
  'ContaPagarID', 'NumeroParcela', 'Sacado', 'SituacaoParcela',
  'Vencimento', 'Categoria', 'ContaID', 'TipoRecebimento',
  'FormaCobranca', 'DataPagamento', 'RetornoOperacao',
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

/** Gera lista de datas DD/MM/YYYY entre dois ISO dates */
function getDatesInRangePtBR(startISO: string, endISO: string): string[] {
  const result: string[] = [];
  const cur = new Date(startISO + 'T12:00:00');
  const end = new Date(endISO + 'T12:00:00');
  while (cur <= end) {
    const dd = String(cur.getDate()).padStart(2, '0');
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    result.push(`${dd}/${mm}/${cur.getFullYear()}`);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/** Converte DD/MM/YYYY para YYYY-MM-DD */
function ptBRtoISO(ptbr: string): string {
  const [dd, mm, yyyy] = ptbr.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Helpers ─────────────────────────────────────────────────────
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

type SyncStatus = 'full' | 'partial' | 'none';

interface SyncMapEntry {
  distinctDays: number;
  totalDays: number;
  status: SyncStatus;
  records: number;
}

// ── Componente ──────────────────────────────────────────────────
interface Props {
  unidades: Unidade[];
  accentColor: string;
}

export default function ConfiguracoesSyncPage({ unidades, accentColor }: Props) {
  // Seleção de unidades
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const unitBtnRef = useRef<HTMLButtonElement>(null);

  // Seleção dos tipos financeiros a sincronizar
  const [syncTypes, setSyncTypes] = useState<Set<SyncType>>(new Set<SyncType>(['cp', 'cr']));
  const toggleSyncType = (t: SyncType) => {
    setSyncTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size > 1) next.delete(t); // impede desmarcar ambos
      } else {
        next.add(t);
      }
      return next;
    });
  };

  // Período por data completa (dia/mês/ano)
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
  const defaultEnd = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(daysInMonth(today.getFullYear(), today.getMonth() + 1))}`;
  const [dataInicio, setDataInicio] = useState(defaultStart);
  const [dataFim, setDataFim] = useState(defaultEnd);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncSuccess, setSyncSuccess] = useState('');

  // Modal de importação de Caixa (PDF)
  const [caixaModalOpen, setCaixaModalOpen] = useState(false);

  // Mapa de status: { [unidadeId]: { [YYYY-MM]: SyncMapEntry } }
  const [syncMap, setSyncMap] = useState<Record<string, Record<string, SyncMapEntry>>>({});
  const [loadingMap, setLoadingMap] = useState(false);

  const cancelRef = useRef(false);

  // ── Período da tabela (ano inteiro corrente por padrão) ───────
  const currentYear = today.getFullYear();
  const [tabelaAno, setTabelaAno] = useState(currentYear);
  const tabelaYears = useMemo(() => {
    const arr: number[] = [];
    for (let y = currentYear - 3; y <= currentYear + 1; y++) arr.push(y);
    return arr;
  }, [currentYear]);

  const tableMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      key: `${tabelaAno}-${pad2(i + 1)}`,
      label: `${MESES_PT[i]}/${tabelaAno}`,
      year: tabelaAno,
      month: i + 1,
    }));
  }, [tabelaAno]);

  // ── Carregar mapa de sincronização do banco ───────────────────
  const loadSyncMap = useCallback(async () => {
    if (!unidades.length) return;
    setLoadingMap(true);
    try {
      const ids = unidades.map(u => u.id);
      const inicioAno = `${tabelaAno}-01-01`;
      const fimAno = `${tabelaAno}-12-31`;

      const dias: SyncDia[] = await SyncDiasAPI.listar(ids, inicioAno, fimAno);

      // Agrupar por unidade → mês. Dedupe dias por (unidade, data), pois
      // cada dia pode aparecer 2x (tipo=cp e tipo=cr) apos PR1b.
      const map: Record<string, Record<string, SyncMapEntry>> = {};
      const seenDays: Record<string, Set<string>> = {};
      for (const u of unidades) map[u.id] = {};

      for (const d of dias) {
        const dt = new Date(d.data + 'T12:00:00');
        if (isNaN(dt.getTime())) continue;
        const mesKey = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
        const seenKey = `${d.unidade_id}|${mesKey}`;

        if (!map[d.unidade_id]) map[d.unidade_id] = {};
        if (!map[d.unidade_id][mesKey]) {
          const total = daysInMonth(dt.getFullYear(), dt.getMonth() + 1);
          map[d.unidade_id][mesKey] = { distinctDays: 0, totalDays: total, status: 'none', records: 0 };
        }

        if (!seenDays[seenKey]) seenDays[seenKey] = new Set();
        if (!seenDays[seenKey].has(d.data)) {
          seenDays[seenKey].add(d.data);
          map[d.unidade_id][mesKey].distinctDays++;
        }
        map[d.unidade_id][mesKey].records += d.registros;
      }

      // Calcular status
      for (const uid of Object.keys(map)) {
        for (const mesKey of Object.keys(map[uid])) {
          const entry = map[uid][mesKey];
          if (entry.distinctDays >= entry.totalDays) entry.status = 'full';
          else if (entry.distinctDays > 0) entry.status = 'partial';
          else entry.status = 'none';
        }
      }

      setSyncMap(map);
    } catch (err) {
      console.error('Erro ao carregar mapa de sync:', err);
    } finally {
      setLoadingMap(false);
    }
  }, [unidades, tabelaAno]);

  useEffect(() => { loadSyncMap(); }, [loadSyncMap]);

  // ── Toggle unidades ───────────────────────────────────────────
  const toggleUnit = (id: string) => {
    setSelectedUnits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllUnits = () => {
    if (selectedUnits.size === unidades.length) setSelectedUnits(new Set());
    else setSelectedUnits(new Set(unidades.map(u => u.id)));
  };

  // ── Sincronizar ────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (selectedUnits.size === 0) return;
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    cancelRef.current = false;

    const units = unidades.filter(u => selectedUnits.has(u.id));
    const syncCP = syncTypes.has('cp');
    const syncCR = syncTypes.has('cr');
    let totalSynced = 0;

    try {
      for (let ui = 0; ui < units.length; ui++) {
        if (cancelRef.current) break;
        const u = units[ui];
        const codigoCliente = u.codigoSponte || '35695';
        const token = u.tokenSponte || 'fxW1Et2vS8Vf';
        const curYear = new Date().getFullYear();

        // ── 1. Pendentes (busca amplo para não perder contas em aberto) ──
        if (syncCP) {
          setSyncProgress(`[${ui + 1}/${units.length}] ${u.nome}: Buscando contas a pagar pendentes...`);
          try {
            const pendentesRes = await axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelasPagar', {
              params: {
                nCodigoCliente: codigoCliente,
                sToken: token,
                sParametrosBusca: `Situacao=A Pagar&DataInicial=01/01/${curYear - 1}&DataFinal=31/12/${curYear + 1}`,
              },
              timeout: 30000,
            });
            const pendentes = parseSponteXML(pendentesRes.data);
            if (pendentes.length > 0) {
              setSyncProgress(`[${ui + 1}/${units.length}] ${u.nome}: Salvando ${pendentes.length} contas a pagar pendentes...`);
              await SyncAPI.syncContasPagar(u.id, pendentes);
              totalSynced += pendentes.length;
            }
          } catch { /* continua */ }
        }

        if (syncCR) {
          setSyncProgress(`[${ui + 1}/${units.length}] ${u.nome}: Buscando mensalidades a receber...`);
          try {
            const pendentesRes = await axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelas', {
              params: {
                nCodigoCliente: codigoCliente,
                sToken: token,
                sParametrosBusca: `Situacao=A Receber&DataInicial=01/01/${curYear - 1}&DataFinal=31/12/${curYear + 1}`,
              },
              timeout: 30000,
            });
            const pendentes = parseParcelasReceberXML(pendentesRes.data);
            if (pendentes.length > 0) {
              setSyncProgress(`[${ui + 1}/${units.length}] ${u.nome}: Salvando ${pendentes.length} mensalidades a receber...`);
              await SyncAPI.syncContasReceber(u.id, pendentes);
              totalSynced += pendentes.length;
            }
          } catch { /* continua */ }
        }

        // ── 2. Pagas/Recebidas dia a dia no período selecionado ──
        const datas = getDatesInRangePtBR(dataInicio, dataFim);
        const BATCH = 5;

        for (let i = 0; i < datas.length; i += BATCH) {
          if (cancelRef.current) break;
          const batch = datas.slice(i, i + BATCH);
          setSyncProgress(
            `[${ui + 1}/${units.length}] ${u.nome}: Sincronizando dias ${Math.min(i + BATCH, datas.length)} de ${datas.length}...`
          );

          // Para cada dia, dispara em paralelo as requisições dos tipos selecionados
          const cpBatch = syncCP
            ? await Promise.all(batch.map(data =>
                axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelasPagar', {
                  params: {
                    nCodigoCliente: codigoCliente,
                    sToken: token,
                    sParametrosBusca: `DataPagamento=${data}`,
                  },
                  timeout: 20000,
                })
                  .then(r =>
                    parseSponteXML(r.data).filter(
                      p => p.SituacaoParcela && p.SituacaoParcela !== 'Pendente'
                    )
                  )
                  .catch(() => [] as ParcelaPagar[])
              ))
            : batch.map(() => [] as ParcelaPagar[]);

          const crBatch = syncCR
            ? await Promise.all(batch.map(data =>
                axios.get('/api-sponte/WSAPIEdu.asmx/GetParcelas', {
                  params: {
                    nCodigoCliente: codigoCliente,
                    sToken: token,
                    sParametrosBusca: `DataPagamento=${data}`,
                  },
                  timeout: 20000,
                })
                  .then(r =>
                    parseParcelasReceberXML(r.data).filter(
                      p => p.SituacaoParcela && p.SituacaoParcela !== 'A Receber'
                    )
                  )
                  .catch(() => [] as ParcelaReceber[])
              ))
            : batch.map(() => [] as ParcelaReceber[]);

          // Persiste em cada tabela
          if (syncCP) {
            const pagasNoLote = cpBatch.flat();
            if (pagasNoLote.length > 0) {
              await SyncAPI.syncContasPagar(u.id, pagasNoLote);
              totalSynced += pagasNoLote.length;
            }
          }
          if (syncCR) {
            const recebidasNoLote = crBatch.flat();
            if (recebidasNoLote.length > 0) {
              await SyncAPI.syncContasReceber(u.id, recebidasNoLote);
              totalSynced += recebidasNoLote.length;
            }
          }

          // Registra cada dia sincronizado por tipo (linhas separadas em etp_sync_dias)
          if (syncCP) {
            const diasCP = batch.map((dataPtBR, idx) => ({
              data: ptBRtoISO(dataPtBR),
              registros: cpBatch[idx].length,
            }));
            await SyncDiasAPI.registrarBatch(u.id, diasCP, 'cp');
          }
          if (syncCR) {
            const diasCR = batch.map((dataPtBR, idx) => ({
              data: ptBRtoISO(dataPtBR),
              registros: crBatch[idx].length,
            }));
            await SyncDiasAPI.registrarBatch(u.id, diasCR, 'cr');
          }
        }

        // Logs separados por tipo para auditoria
        if (syncCP) await SyncAPI.logSync(u.id, 'contas_pagar', 'sucesso', totalSynced);
        if (syncCR) await SyncAPI.logSync(u.id, 'contas_receber', 'sucesso', totalSynced);
      }

      const tiposLabel = [syncCP && 'Contas a Pagar', syncCR && 'Contas a Receber'].filter(Boolean).join(' + ');
      setSyncSuccess(`Sincronização concluída (${tiposLabel}). ${totalSynced} registros processados em ${units.length} unidade(s).`);
      await loadSyncMap();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number }; message?: string };
      const msg = e?.response?.status
        ? `Erro HTTP ${e.response.status}`
        : e?.message || 'Erro desconhecido';
      setSyncError(`Erro durante sincronização: ${msg}`);
    } finally {
      setSyncing(false);
      setSyncProgress('');
    }
  }, [selectedUnits, syncTypes, unidades, dataInicio, dataFim, loadSyncMap]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-8">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-8">
        <Settings size={24} style={{ color: accentColor }} />
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
      </div>

      <section>
        <div className="mb-6">
          <h2 className="text-base font-semibold text-foreground">Sincronizar</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sincronize os dados financeiros do Sponte para o banco local. Selecione as unidades e o período desejado.
          </p>
        </div>

        {/* ── Controles ── */}
        <Card className="max-w-4xl border border-border bg-card p-6 mb-6 overflow-visible">
          <div className="flex flex-wrap gap-6 items-end">
            {/* Seleção de unidades */}
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Unidades
              </label>
              <button
                ref={unitBtnRef}
                className="flex items-center justify-between w-full gap-2 bg-background border border-border px-3 py-2 rounded-lg text-sm transition-colors hover:border-primary/40"
                onClick={() => setUnitDropdownOpen(o => !o)}
              >
                <span className={cn(selectedUnits.size > 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                  {selectedUnits.size === 0
                    ? 'Selecionar unidades...'
                    : selectedUnits.size === unidades.length
                      ? 'Todas as unidades'
                      : `${selectedUnits.size} unidade(s)`}
                </span>
                <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', unitDropdownOpen && 'rotate-180')} />
              </button>
              {unitDropdownOpen && createPortal(
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setUnitDropdownOpen(false)} />
                  <div
                    className="fixed bg-popover border border-border rounded-xl p-1.5 z-[9999] shadow-2xl max-h-[280px] overflow-y-auto"
                    style={{
                      top: (unitBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                      left: unitBtnRef.current?.getBoundingClientRect().left ?? 0,
                      minWidth: Math.max(unitBtnRef.current?.getBoundingClientRect().width ?? 0, 240),
                    }}
                  >
                    <button
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors',
                        selectedUnits.size === unidades.length ? 'font-semibold' : 'text-foreground hover:bg-muted/50'
                      )}
                      style={selectedUnits.size === unidades.length ? { background: `${accentColor}15`, color: accentColor } : {}}
                      onClick={toggleAllUnits}
                    >
                      <CheckCircle2 size={14} className={selectedUnits.size === unidades.length ? '' : 'opacity-30'} />
                      Selecionar todas
                    </button>
                    <div className="h-px bg-border my-1" />
                    {unidades.map(u => {
                      const sel = selectedUnits.has(u.id);
                      return (
                        <button
                          key={u.id}
                          className={cn(
                            'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors',
                            sel ? 'font-semibold' : 'text-foreground hover:bg-muted/50'
                          )}
                          style={sel ? { background: `${accentColor}15`, color: accentColor } : {}}
                          onClick={() => toggleUnit(u.id)}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: u.cor }} />
                          <span className="flex-1 text-left truncate">{u.nome}</span>
                          {sel && <Check size={13} />}
                        </button>
                      );
                    })}
                  </div>
                </>,
                document.body
              )}
            </div>

            {/* Data início */}
            <div className="min-w-[160px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Data Início
              </label>
              <input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {/* Data fim */}
            <div className="min-w-[160px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Data Fim
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {/* Tipos a sincronizar (CP / CR) */}
            <div className="min-w-[220px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                Tipos
              </label>
              <div className="flex gap-1.5 bg-background border border-border rounded-lg p-1">
                {([
                  { key: 'cp' as SyncType, label: 'Contas a Pagar' },
                  { key: 'cr' as SyncType, label: 'Contas a Receber' },
                ]).map(({ key, label }) => {
                  const active = syncTypes.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSyncType(key)}
                      disabled={syncing}
                      className={cn(
                        'flex-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50',
                        active ? 'text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      )}
                      style={active ? { background: accentColor } : {}}
                      title={`${active ? 'Remover' : 'Incluir'} ${label} da sincronização`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Botão */}
            <Button
              onClick={handleSync}
              disabled={syncing || selectedUnits.size === 0 || syncTypes.size === 0}
              className="gap-2 font-semibold h-10 px-5"
              style={{ background: accentColor, boxShadow: `0 4px 14px -4px ${accentColor}66` }}
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </Button>

            {/* Botão importar Caixa */}
            <Button
              variant="outline"
              onClick={() => setCaixaModalOpen(true)}
              disabled={syncing}
              className="gap-2 font-semibold h-10 px-5"
              title="Importa despesas pagas pelo Caixa a partir do PDF do relatório Fluxo de Caixa do Sponte."
            >
              <Upload size={15} />
              Importar Despesas do Caixa
            </Button>
          </div>

          {/* Progresso */}
          {syncProgress && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-2.5">
              <RefreshCw size={14} className="animate-spin flex-shrink-0" style={{ color: accentColor }} />
              <span>{syncProgress}</span>
            </div>
          )}

          {/* Sucesso */}
          {syncSuccess && (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <CheckCircle2 size={14} />
              <span>{syncSuccess}</span>
            </div>
          )}

          {/* Erro */}
          {syncError && (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
              <AlertCircle size={14} />
              <span>{syncError}</span>
            </div>
          )}
        </Card>

        {/* ── Tabela de Status ── */}
        <div className="mb-4 flex items-center justify-between max-w-4xl">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Status de Sincronização</h3>
              {loadingMap && <RefreshCw size={12} className="animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cada célula reflete os dias efetivamente sincronizados, registrados no banco de controle.
            </p>
          </div>
          <select
            value={tabelaAno}
            onChange={e => setTabelaAno(Number(e.target.value))}
            className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            {tabelaYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <Card className="max-w-4xl overflow-hidden border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase tracking-wider text-[0.65rem] min-w-[140px] border-b border-r border-border/40 sticky left-0 bg-muted/40 z-10">
                    Unidade
                  </th>
                  {tableMonths.map(m => {
                    const isCurrentMonth = m.key === `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
                    return (
                      <th
                        key={m.key}
                        className={cn(
                          'text-center px-2 py-2.5 font-semibold text-[0.65rem] uppercase tracking-wider border-b border-border/40 min-w-[64px]',
                          isCurrentMonth ? 'text-white' : 'text-muted-foreground'
                        )}
                        style={isCurrentMonth ? { background: accentColor } : {}}
                      >
                        {m.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {unidades.map((u, idx) => (
                  <tr
                    key={u.id}
                    className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                    style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}
                  >
                    <td className="px-4 py-2 border-r border-border/40 sticky left-0 bg-card z-10">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: u.cor }} />
                        <span className="font-semibold text-foreground truncate">{u.nome}</span>
                      </div>
                    </td>
                    {tableMonths.map(m => {
                      const entry = syncMap[u.id]?.[m.key];
                      const status: SyncStatus = entry?.status || 'none';

                      const cellConfig = {
                        full: {
                          bg: '#059669',
                          text: '#fff',
                          icon: <CheckCircle2 size={11} />,
                          title: `Completo: ${entry?.distinctDays ?? 0}/${entry?.totalDays ?? daysInMonth(m.year, m.month)} dias · ${entry?.records ?? 0} registros`,
                        },
                        partial: {
                          bg: '#f59e0b',
                          text: '#fff',
                          icon: <Clock size={11} />,
                          title: `Parcial: ${entry?.distinctDays ?? 0}/${entry?.totalDays ?? daysInMonth(m.year, m.month)} dias · ${entry?.records ?? 0} registros`,
                        },
                        none: {
                          bg: 'transparent',
                          text: '#d1d5db',
                          icon: <MinusCircle size={11} />,
                          title: 'Sem dados sincronizados',
                        },
                      }[status];

                      return (
                        <td key={m.key} className="text-center px-1 py-1.5">
                          <div
                            className="mx-auto flex flex-col items-center justify-center rounded-md transition-all cursor-default"
                            style={{
                              width: 56,
                              height: 36,
                              background: status === 'none' ? undefined : cellConfig.bg,
                              backgroundImage: status === 'none'
                                ? 'repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 1px, transparent 1px, transparent 6px)'
                                : undefined,
                              color: cellConfig.text,
                            }}
                            title={cellConfig.title}
                          >
                            {cellConfig.icon}
                            {status !== 'none' && (
                              <span className="text-[0.55rem] font-bold leading-tight mt-0.5">
                                {entry?.distinctDays}/{entry?.totalDays}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {unidades.length === 0 && (
                  <tr>
                    <td colSpan={tableMonths.length + 1} className="text-center py-8 text-muted-foreground">
                      Nenhuma unidade cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legenda */}
          <div className="flex items-center gap-5 px-4 py-3 border-t border-border/40 bg-muted/20">
            <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
              <div className="w-5 h-3.5 rounded bg-emerald-600" />
              <span>Mês completo (todos os dias)</span>
            </div>
            <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
              <div className="w-5 h-3.5 rounded bg-amber-500" />
              <span>Parcial (alguns dias)</span>
            </div>
            <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
              <div className="w-5 h-3.5 rounded" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #e2e8f0 0px, #e2e8f0 1px, transparent 1px, transparent 6px)', border: '1px solid #e2e8f0' }} />
              <span>Sem dados</span>
            </div>
          </div>
        </Card>
      </section>

      {caixaModalOpen && (
        <ImportarCaixaModal
          unidades={unidades}
          accentColor={accentColor}
          onClose={() => setCaixaModalOpen(false)}
          onImportado={() => { loadSyncMap(); }}
        />
      )}
    </div>
  );
}
