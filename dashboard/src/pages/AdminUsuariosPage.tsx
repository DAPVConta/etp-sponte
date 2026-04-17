import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Users, Loader2, AlertCircle, Trash2, UserPlus,
  ShieldCheck, Building2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmpresasAPI } from '../api/empresas';
import type { Empresa, UsuarioEmpresa } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Visualizador',
};

const usuarioSchema = z.object({
  email: z.string().email('E-mail inválido'),
  role: z.enum(['admin', 'editor', 'viewer']),
});
type UsuarioForm = z.infer<typeof usuarioSchema>;

export default function AdminUsuariosPage() {
  const qc = useQueryClient();
  const [expandedEmpresa, setExpandedEmpresa] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState<string | null>(null);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['super_admin_empresas'],
    queryFn: () => EmpresasAPI.listarTodas(),
  });

  const { data: usuarios = [] } = useQuery<UsuarioEmpresa[]>({
    queryKey: ['usuarios_empresa', expandedEmpresa],
    queryFn: () => EmpresasAPI.listarUsuarios(expandedEmpresa!),
    enabled: !!expandedEmpresa,
  });

  // ── Form ────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UsuarioForm>({
    resolver: zodResolver(usuarioSchema),
    defaultValues: { role: 'viewer' },
  });

  const onSubmit = async (data: UsuarioForm) => {
    if (!showUserForm) return;
    try {
      await EmpresasAPI.convidarUsuario(data.email, showUserForm, data.role);
      await qc.invalidateQueries({ queryKey: ['usuarios_empresa', showUserForm] });
      await qc.invalidateQueries({ queryKey: ['super_admin_empresas'] });
      setShowUserForm(null);
      reset();
      toast.success('Convite enviado! O usuário receberá um e-mail.');
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Erro ao convidar usuário.');
    }
  };

  const desvincularMutation = useMutation({
    mutationFn: ({ userId, empresaId }: { userId: string; empresaId: string }) =>
      EmpresasAPI.desvincularUsuario(userId, empresaId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['usuarios_empresa', vars.empresaId] });
      qc.invalidateQueries({ queryKey: ['super_admin_empresas'] });
      toast.success('Usuário removido da empresa.');
    },
    onError: () => toast.error('Erro ao remover usuário.'),
  });

  return (
    <div className="max-w-[1200px] mx-auto px-10 py-8 animate-fade-in">

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-border/50">
        <h1 className="text-[1.75rem] font-extrabold tracking-tight flex items-center gap-3 text-indigo-500">
          <ShieldCheck size={28} /> Usuários
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerencie os usuários de cada empresa
        </p>
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
          <Users size={64} className="text-border" />
          <h3 className="text-xl font-bold">Nenhuma empresa cadastrada</h3>
          <p className="text-muted-foreground text-sm">Cadastre empresas primeiro para gerenciar seus usuários.</p>
        </div>
      )}

      {/* Lista de empresas com usuarios */}
      <div className="flex flex-col gap-4">
        {empresas.map((empresa: Empresa) => {
          const isExpanded = expandedEmpresa === empresa.id;
          return (
            <Card key={empresa.id} className="overflow-hidden">
              {/* Cabeçalho da empresa */}
              <button
                onClick={() => setExpandedEmpresa(isExpanded ? null : empresa.id)}
                className="w-full p-5 flex items-center gap-4 hover:bg-accent/30 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                  {empresa.logoUrl
                    ? <img src={empresa.logoUrl} alt={empresa.nomeFantasia} className="w-7 h-7 object-contain rounded" />
                    : <Building2 size={16} className="text-indigo-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm">{empresa.nomeFantasia}</h3>
                    {!empresa.ativo && (
                      <Badge variant="secondary" className="text-[0.6rem]">Inativa</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">{empresa.razaoSocial}</p>
                </div>
                <span className="flex items-center gap-1 text-sm text-muted-foreground flex-shrink-0">
                  <Users size={13} /> {empresa.totalUsuarios ?? 0}
                </span>
                {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
              </button>

              {/* Painel expandido: usuários */}
              {isExpanded && (
                <div className="border-t border-border/50 px-5 py-4 bg-background/50">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">
                      <Users size={14} /> Usuários de {empresa.nomeFantasia}
                    </h4>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs h-7"
                      onClick={() => { reset(); setShowUserForm(empresa.id); }}
                    >
                      <UserPlus size={13} /> Convidar
                    </Button>
                  </div>

                  {usuarios.length === 0 ? (
                    <p className="text-muted-foreground text-xs py-2">Nenhum usuário vinculado.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {usuarios.map(u => (
                        <div
                          key={u.userId}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-card border border-border/50"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{u.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Desde {new Date(u.criadoEm).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant="outline" className="text-[0.65rem]">
                              {ROLE_LABEL[u.role] ?? u.role}
                            </Badge>
                            <button
                              onClick={() => desvincularMutation.mutate({ userId: u.userId, empresaId: empresa.id })}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Remover usuário"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Modal: convidar usuario */}
      <Dialog open={!!showUserForm} onOpenChange={open => !isSubmitting && !open && setShowUserForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Convidar Usuário</DialogTitle>
            <DialogDescription>
              Um e-mail de convite será enviado para o usuário criar sua senha.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">E-mail</Label>
              <Input type="email" placeholder="usuario@email.com" disabled={isSubmitting} {...register('email')} />
              {errors.email && <Erro msg={errors.email.message} />}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Perfil de Acesso</Label>
              <select
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...register('role')}
              >
                <option value="viewer">Visualizador — somente leitura</option>
                <option value="editor">Editor — edita planejamento</option>
                <option value="admin">Admin — gerencia a empresa</option>
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowUserForm(null)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-1.5">
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Enviar Convite
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
