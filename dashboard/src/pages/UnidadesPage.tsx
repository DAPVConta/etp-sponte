import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2, Plus, Pencil, Trash2, AlertCircle, Palette, Hash, Key, FileText,
  Loader2, Eye, EyeOff, Check
} from 'lucide-react';
import { toast } from 'sonner';
import type { Unidade } from '../types';
import { UnidadesAPI } from '../api/unidades';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── CNPJ helpers ──────────────────────────────────────────────────────────────
function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (d: string, len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) { sum += parseInt(d.charAt(len - i)) * pos--; if (pos < 2) pos = 9; }
    const r = sum % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(digits, 12) === parseInt(digits.charAt(12)) && calc(digits, 13) === parseInt(digits.charAt(13));
}

// ── Color palette ──────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e', '#84cc16',
  '#14b8a6', '#a855f7', '#d946ef', '#f97316', '#0ea5e9',
];

// ── Zod schema ────────────────────────────────────────────────────────────────
const schema = z.object({
  cnpj: z.string()
    .min(1, 'CNPJ é obrigatório')
    .refine(v => v.replace(/\D/g, '').length === 14, 'CNPJ incompleto')
    .refine(v => validateCNPJ(v), 'CNPJ inválido (dígitos verificadores)'),
  nome: z.string().min(1, 'Nome é obrigatório'),
  cor: z.string().min(1),
  codigoSponte: z.string().min(1, 'Código Sponte é obrigatório'),
  tokenSponte: z.string().min(1, 'Token Sponte é obrigatório'),
});

type FormData = z.infer<typeof schema>;

interface Props {
  unidades: Unidade[];
  onUpdateUnidades: () => Promise<void>;
  accentColor: string;
}

export default function UnidadesPage({ unidades, onUpdateUnidades, accentColor }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { cnpj: '', nome: '', cor: '#6366f1', codigoSponte: '', tokenSponte: '' },
  });

  const watchCor = watch('cor');

  const openCreate = () => {
    reset({ cnpj: '', nome: '', cor: '#6366f1', codigoSponte: '', tokenSponte: '' });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (u: Unidade) => {
    reset({ cnpj: u.cnpj, nome: u.nome, cor: u.cor, codigoSponte: u.codigoSponte, tokenSponte: u.tokenSponte });
    setEditingId(u.id);
    setShowForm(true);
  };

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      if (editingId) await UnidadesAPI.atualizar(editingId, data);
      else await UnidadesAPI.criar(data);
      await onUpdateUnidades();
      setShowForm(false);
      toast.success(editingId ? 'Unidade atualizada com sucesso!' : 'Unidade cadastrada com sucesso!');
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(e?.message || 'Erro ao salvar unidade.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await UnidadesAPI.excluir(id);
      await onUpdateUnidades();
      setDeleteConfirm(null);
      toast.success('Unidade excluída.');
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(e?.message || 'Erro ao excluir unidade.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-10 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3" style={{ color: accentColor }}>
            <Building2 size={28} /> Cadastro de Unidades
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Gerencie as unidades educacionais e suas integrações com o Sponte</p>
        </div>
        <Button onClick={openCreate} className="gap-2" style={{ background: accentColor, boxShadow: `0 4px 14px ${accentColor}55` }}>
          <Plus size={18} /> Nova Unidade
        </Button>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={showForm} onOpenChange={open => !saving && setShowForm(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Unidade' : 'Nova Unidade'}</DialogTitle>
            <DialogDescription>Preencha os dados da unidade educacional.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            {/* Color Picker */}
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide font-semibold">
                <Palette size={13} /> Cor da Unidade
              </Label>
              <div className="flex flex-wrap gap-2 items-center">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c} type="button"
                    className={cn("w-7 h-7 rounded-full border-none flex items-center justify-center transition-transform", watchCor === c ? 'scale-115' : 'hover:scale-110')}
                    style={{ background: c, boxShadow: watchCor === c ? `0 0 0 3px ${c}55` : 'none' }}
                    onClick={() => setValue('cor', c)} disabled={saving}
                  >
                    {watchCor === c && <Check size={12} color="white" />}
                  </button>
                ))}
                <div className="flex items-center gap-1.5 cursor-pointer">
                  <input type="color" value={watchCor} onChange={e => setValue('cor', e.target.value)} className="w-7 h-7 rounded-full border-none p-0 cursor-pointer bg-none outline-none" title="Cor personalizada" disabled={saving} />
                  <span className="text-muted-foreground text-xs">Personalizar</span>
                </div>
              </div>
              <div className="h-1 rounded mt-1 transition-all" style={{ background: `linear-gradient(90deg, ${watchCor}, ${watchCor}88)` }} />
            </div>

            {/* CNPJ */}
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide font-semibold"><FileText size={13} /> CNPJ</Label>
              <Input
                placeholder="00.000.000/0000-00"
                maxLength={18}
                disabled={saving}
                className={errors.cnpj ? 'border-destructive focus-visible:ring-destructive/30' : ''}
                {...register('cnpj')}
                onChange={e => setValue('cnpj', formatCNPJ(e.target.value), { shouldValidate: true })}
              />
              {errors.cnpj && <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={11} />{errors.cnpj.message}</span>}
            </div>

            {/* Nome */}
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide font-semibold"><Building2 size={13} /> Nome da Unidade</Label>
              <Input placeholder="Ex: ETP Recife — Unidade Centro" disabled={saving} className={errors.nome ? 'border-destructive focus-visible:ring-destructive/30' : ''} {...register('nome')} />
              {errors.nome && <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={11} />{errors.nome.message}</span>}
            </div>

            {/* Código + Token */}
            <div className="grid grid-cols-2 gap-4 max-[500px]:grid-cols-1">
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide font-semibold"><Hash size={13} /> Código Sponte</Label>
                <Input placeholder="Ex: 35695" disabled={saving} className={errors.codigoSponte ? 'border-destructive focus-visible:ring-destructive/30' : ''} {...register('codigoSponte')} />
                {errors.codigoSponte && <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={11} />{errors.codigoSponte.message}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide font-semibold"><Key size={13} /> Token Sponte</Label>
                <Input placeholder="Ex: fxW1Et2vS8Vf" disabled={saving} className={errors.tokenSponte ? 'border-destructive focus-visible:ring-destructive/30' : ''} {...register('tokenSponte')} />
                {errors.tokenSponte && <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={11} />{errors.tokenSponte.message}</span>}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving} style={{ background: watchCor, boxShadow: !saving ? `0 4px 14px ${watchCor}55` : undefined }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {editingId ? 'Salvar Alterações' : 'Cadastrar Unidade'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation modal */}
      <Dialog open={!!deleteConfirm} onOpenChange={open => !deleting && !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 text-center py-2">
            <AlertCircle size={32} className="text-destructive" />
            <p className="text-sm">Tem certeza que deseja excluir a unidade <strong>{unidades.find(u => u.id === deleteConfirm)?.nome}</strong>?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} disabled={deleting}>
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Units Grid */}
      {unidades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Building2 size={64} className="text-border" />
          <h3 className="text-xl font-bold">Nenhuma unidade cadastrada</h3>
          <p className="text-muted-foreground text-sm">Comece cadastrando a primeira unidade educacional.</p>
          <Button onClick={openCreate} className="gap-2 mt-2" style={{ background: accentColor }}>
            <Plus size={18} /> Cadastrar Primeira Unidade
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
          {unidades.map((u, idx) => (
            <Card
              key={u.id}
              className="p-6 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl animate-fade-in-up"
              style={{ borderTop: `4px solid ${u.cor}`, animationDelay: `${idx * 60}ms` }}
            >
              <div className="flex justify-between items-center mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center relative" style={{ background: `${u.cor}22`, color: u.cor }}>
                  <Building2 size={16} />
                </div>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => openEdit(u)} title="Editar">
                    <Pencil size={14} />
                  </Button>
                  <Button variant="outline" size="icon" className="w-8 h-8 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30" onClick={() => setDeleteConfirm(u.id)} title="Excluir">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>

              <h3 className="text-[1.05rem] font-bold mb-1">{u.nome}</h3>
              <p className="text-muted-foreground text-sm mb-4 tabular-nums">{u.cnpj}</p>

              <div className="flex flex-col gap-2 mb-4">
                <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-background/50 border border-border/50">
                  <span className="text-[0.7rem] text-muted-foreground uppercase tracking-wide font-semibold flex items-center gap-1.5"><Hash size={11} /> Código Sponte</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: u.cor }}>{u.codigoSponte}</span>
                </div>
                <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-background/50 border border-border/50">
                  <span className="text-[0.7rem] text-muted-foreground uppercase tracking-wide font-semibold flex items-center gap-1.5"><Key size={11} /> Token</span>
                  <span className="text-sm font-semibold font-mono flex items-center gap-2">
                    {showToken[u.id] ? u.tokenSponte : '••••••••••••'}
                    <button onClick={() => setShowToken(s => ({ ...s, [u.id]: !s[u.id] }))} className="opacity-60 hover:opacity-100 transition-opacity" title={showToken[u.id] ? 'Ocultar' : 'Mostrar'}>
                      {showToken[u.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </span>
                </div>
              </div>

              <div className="border-t border-border/50 pt-3">
                <span className="text-[0.72rem] text-muted-foreground">
                  Cadastrado em {new Date(u.criadoEm).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
