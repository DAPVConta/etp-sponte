import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

interface Props {
  children: React.ReactNode;
  // Role minimo exigido para acessar a rota
  minRole?: Exclude<UserRole, 'super_admin'> | 'super_admin';
}

// Hierarquia: super_admin > admin > editor > viewer
const ROLE_LEVEL: Record<UserRole, number> = {
  super_admin: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export default function ProtectedRoute({ children, minRole = 'viewer' }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Nao autenticado → login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Sem empresa vinculada (e nao e super_admin) → avisa
  if (!user.empresaId && user.role !== 'super_admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-bold mb-2">Sem acesso</h2>
          <p className="text-muted-foreground text-sm">
            Sua conta ainda não foi vinculada a nenhuma empresa.
            Entre em contato com o administrador.
          </p>
        </div>
      </div>
    );
  }

  // Role insuficiente
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[minRole]) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-bold mb-2">Acesso negado</h2>
          <p className="text-muted-foreground text-sm">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
