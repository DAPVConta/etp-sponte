import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2, Plus, Users, ToggleLeft, ToggleRight, Loader2,
  AlertCircle, Check, Mail, FileText, Landmark, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmpresasAPI } from '../api/empresas';
import type { Empresa } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';

// ── Helpers ───────────────────────────────────────────────────

function formatCNPJ(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function validateCNPJ(cnpj: string) {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (s: string, len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) { sum += parseInt(s[len - i]) * pos--; if (pos < 2) pos = 9; }
    const r = sum % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(d, 12) === parseInt(d[12]) && calc(d, 13) === parseInt(d[13]);
}

// ── Schema ───────────────────────────────────────────────────

const empresaSchema = z.object({
  cnpj: z.string()
    .min(1, 'CNPJ é obrigatório')
    .refine(v => v.replace(/\D/g, '').length === 14, 'CNPJ incompleto')
    .refine(v => validateCNPJ(v), 'CNPJ inválido'),
  razaoSocial: z.string().min(1, 'Razão Social é obrigatória'),
  nomeFantasia: z.string().min(1, 'Nome Fantasia é obrigatório'),
  email: z.string().email('E-mail inválido').or(z.literal('')).optional(),
  logoUrl: z.string().url('URL inválida').or(z.literal('')).optional(),
});
type EmpresaForm = z.infer<typeof empresaSchema>;

// ── Componente ────────────────────────────────────────────────

export default function AdminEmpresasPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['super_admin_empresas'],
    queryFn: () => EmpresasAPI.listarTodas(),
  });

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmpresaForm>({ resolver: zodResolver(empresaSchema) });

  const onSubmit = async (data: EmpresaForm) => {
    try {
      await EmpresasAPI.criar({
        cnpj:         data.cnpj,
        razaoSocial:  data.razaoSocial,
        nomeFantasia: data.nomeFantasia,
        email:        data.email || undefined,
        logoUrl:      data.logoUrl || undefined,
      });
      await qc.invalidateQueries({ queryKey: ['super_admin_empresas'] });
      setShowForm(false);
      reset();
      toast.success('Empresa criada com sucesso!');
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Erro ao criar empresa.');
    }
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      EmpresasAPI.toggleAtivo(id, ativo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super_admin_empresas'] }),
    onError: () => toast.error('Erro ao alterar status da empresa.'),
  });

  return (
    <div className="max-w-[1200px] mx-auto px-10 py-8 animate-fade-in">

      {/* Header */}
      <div className="flex justify-between items-start mb-8 pb-6 border-b border-border/50 flex-wrap gap-4">
        <div>
          <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3 text-indigo-500">
            <ShieldCheck size={28} /> Empresas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie todas as empresas clientes do sistema
          </p>
        </div>
        <Button
          onClick={() => { reset(); setShowForm(true); }}
          className="gap-2 bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus size={18} /> Nova Empresa
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && empresas.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <Building2 size={64} className="text-border" />
          <h3 className="text-xl font-bold">Nenhuma empresa cadastrada</h3>
          <p className="text-muted-foreground text-sm">Crie a primeira empresa para começar.</p>
          <Button onClick={() => setShowForm(true)} className="gap-2 mt-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus size={18} /> Criar Primeira Empresa
          </Button>
        </div>
      )}

      {/* Lista */}
      <div className="flex flex-col gap-4">
        {empresas.map((empresa: Empresa) => (
          <Card key={empresa.id} className="p-5 flex items-start gap-4 flex-wrap">
            {/* Logo / ícone */}
            <div className="w-11 h-11 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              {empresa.logoUrl
                ? <img src={empresa.logoUrl} alt={empresa.nomeFantasia} className="w-9 h-9 object-contain rounded" />
                : <Building2 size={20} className="text-indigo-500" />
              }
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <h3 className="font-bold text-base">{empresa.nomeFantasia}</h3>
                <Badge variant={empresa.ativo ? 'default' : 'secondary'} className="text-[0.65rem]">
                  {empresa.ativo ? 'Ativa' : 'Inativa'}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">{empresa.razaoSocial}</p>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                  <FileText size={11} /> {empresa.cnpj}
                </span>
                {empresa.email && (
                  <span className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                    <Mail size={11} /> {empresa.email}
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-shrink-0 self-center">
              <span className="flex items-center gap-1">
                <Building2 size={13} /> {empresa.totalUnidades ?? 0} unidades
              </span>
              <span className="flex items-center gap-1">
                <Users size={13} /> {empresa.totalUsuarios ?? 0} usuários
              </span>
            </div>

            {/* Toggle */}
            <div className="flex items-center flex-shrink-0 self-center">
              <button
                onClick={() => toggleMutation.mutate({ id: empresa.id, ativo: !empresa.ativo })}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={empresa.ativo ? 'Desativar empresa' : 'Ativar empresa'}
              >
                {empresa.ativo
                  ? <ToggleRight size={22} className="text-green-500" />
                  : <ToggleLeft size={22} />
                }
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Modal: nova empresa */}
      <Dialog open={showForm} onOpenChange={open => !isSubmitting && setShowForm(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 size={18} /> Nova Empresa
            </DialogTitle>
            <DialogDescription>
              Cadastre um novo cliente no sistema. Cada empresa tem dados e usuários isolados.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <FileText size={12} /> CNPJ
              </Label>
              <Input
                placeholder="00.000.000/0000-00"
                maxLength={18}
                disabled={isSubmitting}
                {...register('cnpj')}
                onChange={e => setValue('cnpj', formatCNPJ(e.target.value), { shouldValidate: true })}
              />
              {errors.cnpj && <Erro msg={errors.cnpj.message} />}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Landmark size={12} /> Razão Social
              </Label>
              <Input placeholder="Ex: Grupo Educacional XYZ Ltda" disabled={isSubmitting} {...register('razaoSocial')} />
              {errors.razaoSocial && <Erro msg={errors.razaoSocial.message} />}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Building2 size={12} /> Nome Fantasia
              </Label>
              <Input placeholder="Ex: Grupo XYZ" disabled={isSubmitting} {...register('nomeFantasia')} />
              {errors.nomeFantasia && <Erro msg={errors.nomeFantasia.message} />}
            </div>

            <div className="grid grid-cols-2 gap-4 max-[500px]:grid-cols-1">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Mail size={12} /> E-mail (opcional)
                </Label>
                <Input type="email" placeholder="contato@empresa.com" disabled={isSubmitting} {...register('email')} />
                {errors.email && <Erro msg={errors.email.message} />}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">URL do Logo (opcional)</Label>
                <Input placeholder="https://..." disabled={isSubmitting} {...register('logoUrl')} />
                {errors.logoUrl && <Erro msg={errors.logoUrl.message} />}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Criar Empresa
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Erro({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <span className="text-xs text-destructive flex items-center gap-1">
      <AlertCircle size={11} /> {msg}
    </span>
  );
}
