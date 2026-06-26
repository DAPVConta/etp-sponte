import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  parseRelacaoContasPDF, UnsupportedReportError, type RelacaoContasRelatorio,
} from '@/lib/pdf-relacao-contas';
import { importarRelatorioContas } from '@/api/relatorioImport';
import type { Unidade } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  unidades: Unidade[];
  accentColor: string;
  onClose: () => void;
  onImportado: (mensagem?: string) => void;
}

const fmtBR = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export default function ImportarRelatorioModal({ unidades, accentColor, onClose, onImportado }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [relatorio, setRelatorio] = useState<RelacaoContasRelatorio | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [unidadeId, setUnidadeId] = useState<string>('');
  const [error, setError] = useState('');
  const [sucesso, setSucesso] = useState('');

  const handleFile = async (f: File) => {
    setError('');
    setSucesso('');
    setFile(f);
    setRelatorio(null);
    setParsing(true);
    try {
      const rel = await parseRelacaoContasPDF(f);
      if (!rel.periodoInicio || !rel.periodoFim) {
        throw new Error('Não consegui identificar o período no relatório.');
      }
      setRelatorio(rel);
      setSelectedIndices(new Set(rel.itens.map((_, i) => i)));
    } catch (e) {
      if (e instanceof UnsupportedReportError) setError(e.message);
      else setError(e instanceof Error ? e.message : 'Falha ao ler o PDF.');
    } finally {
      setParsing(false);
    }
  };

  const tipoLabel = relatorio?.tipo === 'receber' ? 'Contas a Receber' : 'Contas a Pagar';

  const handleImport = async () => {
    if (!relatorio || !unidadeId) return;
    const itensSelecionados = relatorio.itens.filter((_, i) => selectedIndices.has(i));
    if (itensSelecionados.length === 0) return;
    setImporting(true);
    setError('');
    setSucesso('');
    try {
      const r = await importarRelatorioContas(
        unidadeId,
        relatorio.tipo,
        relatorio.periodoInicio,
        relatorio.periodoFim,
        itensSelecionados,
      );
      const mensagem =
        `Importação concluída (${tipoLabel}): ${r.inseridos} lançamento(s) inseridos` +
        (r.removidosAntesDeInserir > 0
          ? ` (${r.removidosAntesDeInserir} registros anteriores do mesmo período foram substituídos).`
          : '.');
      setSucesso(mensagem);
      onImportado(mensagem);
      setTimeout(() => onClose(), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar.');
    } finally {
      setImporting(false);
    }
  };

  const nomeUnidadeSelecionada = unidades.find(u => u.id === unidadeId)?.nome ?? '';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Importar Relatório de Contas</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anexe o PDF do relatório <strong>"Relação de Contas Pagas"</strong> ou{' '}
              <strong>"Relação de Contas Recebidas"</strong>. Cada lançamento é importado
              individualmente, classificado pelo plano de contas do próprio relatório.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
            disabled={importing}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Upload */}
          {!relatorio && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              className={cn(
                'w-full border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center gap-3 hover:border-primary/50 transition-colors',
                parsing && 'opacity-50 cursor-not-allowed'
              )}
            >
              {parsing
                ? <Loader2 size={28} className="animate-spin text-muted-foreground" />
                : <Upload size={28} className="text-muted-foreground" />}
              <div className="text-sm font-medium">
                {parsing ? 'Lendo relatório...' : 'Clique para selecionar o PDF'}
              </div>
              <div className="text-xs text-muted-foreground">
                .pdf — Relação de Contas Pagas / Recebidas
              </div>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />

          {/* Preview */}
          {relatorio && (
            <>
              <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-4 py-3 text-sm">
                <FileText size={16} className="text-muted-foreground flex-shrink-0" />
                <span className="truncate flex-1">{file?.name}</span>
                <span
                  className="text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ background: `${accentColor}1a`, color: accentColor }}
                >
                  {tipoLabel}
                </span>
                <button
                  onClick={() => { setFile(null); setRelatorio(null); setSelectedIndices(new Set()); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={importing}
                >
                  Trocar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Unidade <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={unidadeId}
                    onChange={e => setUnidadeId(e.target.value)}
                    disabled={importing}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Selecione a unidade...</option>
                    {unidades.map(u => (
                      <option key={u.id} value={u.id}>{u.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Período
                  </label>
                  <div className="bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm">
                    {fmtData(relatorio.periodoInicio)} → {fmtData(relatorio.periodoFim)}
                  </div>
                </div>
              </div>

              {/* O relatorio nao traz o nome da unidade — exige selecao manual */}
              {!unidadeId && (
                <div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                  <strong>Selecione a unidade.</strong> Este relatório não identifica a unidade no PDF —
                  confira que você está importando para a unidade correta.
                </div>
              )}

              {(() => {
                const total = relatorio.itens.length;
                const selCount = selectedIndices.size;
                const allChecked = total > 0 && selCount === total;
                const someChecked = selCount > 0 && selCount < total;
                const totalSel = relatorio.itens.reduce(
                  (s, it, i) => s + (selectedIndices.has(i) ? it.valor : 0), 0);
                const toggleAll = (v: boolean | 'indeterminate') => {
                  if (v === true) setSelectedIndices(new Set(relatorio.itens.map((_, i) => i)));
                  else setSelectedIndices(new Set());
                };
                const toggleIdx = (i: number) => {
                  setSelectedIndices(prev => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  });
                };
                return (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="max-h-[40vh] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                          <tr>
                            <th className="px-3 py-2 w-10">
                              <Checkbox
                                checked={allChecked ? true : (someChecked ? 'indeterminate' : false)}
                                onCheckedChange={toggleAll}
                                disabled={importing}
                                aria-label="Selecionar todos"
                              />
                            </th>
                            <th className="px-3 py-2 text-left">Data</th>
                            <th className="px-3 py-2 text-left">Categoria</th>
                            <th className="px-3 py-2 text-left">Fornecedor / Histórico</th>
                            <th className="px-3 py-2 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relatorio.itens.map((it, i) => {
                            const checked = selectedIndices.has(i);
                            return (
                              <tr key={i} className={cn('border-t border-border', !checked && 'opacity-40')}>
                                <td className="px-3 py-1.5">
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => toggleIdx(i)}
                                    disabled={importing}
                                    aria-label={`Selecionar lançamento ${i + 1}`}
                                  />
                                </td>
                                <td className="px-3 py-1.5 text-xs whitespace-nowrap">{fmtData(it.dataPagamento)}</td>
                                <td className="px-3 py-1.5">
                                  <div className="font-medium">{it.categoria}</div>
                                  {it.grupo && (
                                    <div className="text-[0.65rem] text-muted-foreground uppercase tracking-wide">{it.grupo}</div>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[220px] truncate">
                                  {it.fornecedor}{it.historico ? ` — ${it.historico}` : ''}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{fmtBR(it.valor)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/30 border-t border-border font-semibold sticky bottom-0">
                            <td colSpan={4} className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                              {selCount} de {total} selecionado(s)
                            </td>
                            <td className="px-3 py-2 text-right text-xs">{fmtBR(totalSel)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })()}

              <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Ao importar, qualquer lançamento com <strong>origem = RELATÓRIO</strong> de{' '}
                <strong>{nomeUnidadeSelecionada || 'a unidade selecionada'}</strong> no período{' '}
                <strong>{fmtData(relatorio.periodoInicio)} a {fmtData(relatorio.periodoFim)}</strong>{' '}
                será substituído pelos lançamentos <strong>selecionados</strong> acima.
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /><span>{error}</span>
            </div>
          )}
          {sucesso && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} /><span>{sucesso}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
          <Button variant="outline" onClick={onClose} disabled={importing}>Fechar</Button>
          <Button
            onClick={handleImport}
            disabled={!relatorio || !unidadeId || importing || selectedIndices.size === 0}
            className="gap-2 font-semibold"
            style={{ background: accentColor, boxShadow: `0 4px 14px -4px ${accentColor}66` }}
          >
            {importing && <Loader2 size={14} className="animate-spin" />}
            {importing ? 'Importando...' : 'Importar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
