import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseFluxoCaixaPDF, type FluxoCaixaRelatorio } from '@/lib/pdf-fluxo-caixa';
import { importarLancamentosCaixa } from '@/api/fluxoCaixaImport';
import type { Unidade } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  unidades: Unidade[];
  accentColor: string;
  onClose: () => void;
  onImportado: () => void;
}

const fmtBR = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Normaliza nome: minúsculo, sem acento, sem espaço extra
function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ImportarCaixaModal({ unidades, accentColor, onClose, onImportado }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [relatorio, setRelatorio] = useState<FluxoCaixaRelatorio | null>(null);
  const [unidadeId, setUnidadeId] = useState<string>('');
  const [error, setError] = useState('');
  const [sucesso, setSucesso] = useState('');

  // Match automático da unidade por nome
  const matchUnidade = (nomePDF: string): string => {
    const n = norm(nomePDF);
    // exato
    let u = unidades.find(x => norm(x.nome) === n);
    if (u) return u.id;
    // contém
    u = unidades.find(x => n.includes(norm(x.nome)) || norm(x.nome).includes(n));
    return u?.id ?? '';
  };

  const handleFile = async (f: File) => {
    setError('');
    setSucesso('');
    setFile(f);
    setRelatorio(null);
    setParsing(true);
    try {
      const rel = await parseFluxoCaixaPDF(f);
      if (!rel.periodoInicio || !rel.periodoFim) {
        throw new Error('Não consegui identificar o período no PDF.');
      }
      if (rel.lancamentos.length === 0) {
        throw new Error('Nenhum lançamento encontrado no PDF.');
      }
      setRelatorio(rel);
      const matchedId = matchUnidade(rel.unidadeNome);
      setUnidadeId(matchedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler o PDF.');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!relatorio || !unidadeId) return;
    setImporting(true);
    setError('');
    setSucesso('');
    try {
      const r = await importarLancamentosCaixa(
        unidadeId,
        relatorio.periodoInicio,
        relatorio.periodoFim,
        relatorio.lancamentos
      );
      setSucesso(
        `Importação concluída: ${r.inseridos} lançamento(s) inseridos` +
        (r.removidosAntesDeInserir > 0
          ? ` (${r.removidosAntesDeInserir} registros anteriores do mesmo período foram substituídos).`
          : '.')
      );
      onImportado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar.');
    } finally {
      setImporting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Importar Despesas pagas pelo Caixa</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anexe o PDF do relatório "Fluxo de Caixa" do Sponte (Conta: Caixa).
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
              {parsing ? (
                <Loader2 size={28} className="animate-spin text-muted-foreground" />
              ) : (
                <Upload size={28} className="text-muted-foreground" />
              )}
              <div className="text-sm font-medium">
                {parsing ? 'Lendo PDF...' : 'Clique para selecionar o PDF'}
              </div>
              <div className="text-xs text-muted-foreground">
                Apenas .pdf — formato relatório Fluxo de Caixa
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

          {/* Preview do relatório */}
          {relatorio && (
            <>
              <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-4 py-3 text-sm">
                <FileText size={16} className="text-muted-foreground flex-shrink-0" />
                <span className="truncate flex-1">{file?.name}</span>
                <button
                  onClick={() => { setFile(null); setRelatorio(null); setUnidadeId(''); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={importing}
                >
                  Trocar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Unidade (detectada: "{relatorio.unidadeNome || '—'}")
                  </label>
                  <select
                    value={unidadeId}
                    onChange={e => setUnidadeId(e.target.value)}
                    disabled={importing}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Selecione...</option>
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

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">Categoria</th>
                      <th className="px-3 py-2 text-center">E/S</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.lancamentos.map((l, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 text-xs">{fmtData(l.data)}</td>
                        <td className="px-3 py-1.5">{l.categoria}</td>
                        <td className="px-3 py-1.5 text-center text-xs font-semibold">
                          <span className={cn(
                            'inline-block px-1.5 py-0.5 rounded',
                            l.tipo === 'S' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                          )}>{l.tipo}</span>
                        </td>
                        <td className={cn(
                          'px-3 py-1.5 text-right tabular-nums',
                          l.tipo === 'S' ? 'text-red-700' : 'text-emerald-700'
                        )}>
                          {l.tipo === 'S' ? '-' : '+'}{fmtBR(l.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 border-t border-border font-semibold">
                      <td colSpan={2} className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                        {relatorio.totalRegistros} lançamento(s)
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-emerald-700">
                        +{fmtBR(relatorio.totalEntradas)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-red-700">
                        -{fmtBR(relatorio.totalSaidas)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Ao importar, qualquer registro com <strong>forma_cobranca = CAIXA</strong> desta unidade no período{' '}
                <strong>{fmtData(relatorio.periodoInicio)} a {fmtData(relatorio.periodoFim)}</strong> será substituído pelos lançamentos acima.
              </div>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {sucesso && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} />
              <span>{sucesso}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Fechar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!relatorio || !unidadeId || importing}
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
