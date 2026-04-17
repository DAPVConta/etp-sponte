import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AuthUser, UserRole } from '../types';

// ─────────────────────────────────────────────────────────────
// Context shape
// ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  session: Session | null;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isEditor: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Helper: extrai AuthUser a partir da sessao do Supabase
// ─────────────────────────────────────────────────────────────

async function buildAuthUser(session: Session): Promise<AuthUser> {
  const rawRole = session.user.user_metadata?.role as string | undefined;

  if (rawRole === 'super_admin') {
    return {
      id: session.user.id,
      email: session.user.email ?? '',
      role: 'super_admin',
      empresaId: null,
      empresaNomeFantasia: null,
      empresaRazaoSocial: null,
      empresaLogoUrl: null,
    };
  }

  // Busca vinculo empresa + role do usuario
  const { data, error } = await supabase
    .from('etp_user_empresas')
    .select('role, empresa_id, etp_empresas(nome_fantasia, razao_social, logo_url)')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      id: session.user.id,
      email: session.user.email ?? '',
      role: 'viewer',
      empresaId: null,
      empresaNomeFantasia: null,
      empresaRazaoSocial: null,
      empresaLogoUrl: null,
    };
  }

  const empresa = data.etp_empresas as unknown as {
    nome_fantasia: string;
    razao_social: string;
    logo_url: string | null;
  } | null;

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    role: data.role as UserRole,
    empresaId: data.empresa_id,
    empresaNomeFantasia: empresa?.nome_fantasia ?? null,
    empresaRazaoSocial: empresa?.razao_social ?? null,
    empresaLogoUrl: empresa?.logo_url ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async (s: Session | null) => {
    if (!s) {
      setSession(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setSession(s);
    const authUser = await buildAuthUser(s);
    setUser(authUser);
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => loadUser(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      loadUser(s);
    });

    return () => subscription.unsubscribe();
  }, [loadUser]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const role = user?.role ?? 'viewer';
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = isSuperAdmin || role === 'admin';
  const isEditor = isAdmin || role === 'editor';

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signOut, isSuperAdmin, isAdmin, isEditor }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
