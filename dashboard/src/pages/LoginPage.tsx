import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [authError, setAuthError] = useState('');

  const {
    register, handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setAuthError('');
    try {
      await signIn(data.email, data.password);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const e = err as { message?: string };
      const msg = e?.message ?? '';
      if (msg.includes('Invalid login credentials')) {
        setAuthError('E-mail ou senha incorretos.');
      } else if (msg.includes('Email not confirmed')) {
        setAuthError('Confirme seu e-mail antes de fazer login.');
      } else {
        setAuthError(msg || 'Erro ao fazer login. Tente novamente.');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img
            src="/etp-logo.png"
            alt="ETP"
            className="h-14 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-lg p-8">
          <h1 className="text-2xl font-bold mb-1">Entrar</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Acesse o painel ETP Gestão
          </p>

          {authError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm mb-5">
              <AlertCircle size={15} className="flex-shrink-0" />
              {authError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/* E-mail */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email.com"
                disabled={isSubmitting}
                className={errors.email ? 'border-destructive focus-visible:ring-destructive/30' : ''}
                {...register('email')}
              />
              {errors.email && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle size={11} /> {errors.email.message}
                </span>
              )}
            </div>

            {/* Senha */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Senha
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                  className={errors.password ? 'border-destructive focus-visible:ring-destructive/30 pr-10' : 'pr-10'}
                  {...register('password')}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPass(v => !v)}
                  disabled={isSubmitting}
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {errors.password && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle size={11} /> {errors.password.message}
                </span>
              )}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 w-full gap-2"
            >
              {isSubmitting
                ? <Loader2 size={16} className="animate-spin" />
                : <LogIn size={16} />
              }
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ETP Gestão — Acesso restrito
        </p>
      </div>
    </div>
  );
}
