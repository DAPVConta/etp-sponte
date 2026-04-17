import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import AppSidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import SuperAdminSidebar from './components/SuperAdminSidebar';
import DashboardPage from './pages/DashboardPage';
import UnidadesPage from './pages/UnidadesPage';
import CategoriasPage from './pages/CategoriasPage';
import PlanejamentoPage from './pages/PlanejamentoPage';
import ConfiguracoesPage from './pages/ConfiguracoesPage';
import ConfiguracoesGraficosPage from './pages/ConfiguracoesGraficosPage';
import ConfiguracoesSyncPage from './pages/ConfiguracoesSyncPage';
import LoginPage from './pages/LoginPage';
import AdminEmpresasPage from './pages/AdminEmpresasPage';
import AdminUsuariosPage from './pages/AdminUsuariosPage';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EmpresaConfigProvider } from './contexts/EmpresaConfigContext';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { useLayoutConfig } from './hooks/use-layout-config';
import { hexToHsl, isLightColor } from './lib/color-utils';
import type { Unidade } from './types';
import './index.css';
import { UnidadesAPI } from './api/unidades';
import { AlertCircle } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

const STORAGE_KEY_ACTIVE = 'etp_active_unidade';

// ── Shell interno (requer sessao) ────────────────────────────

function AppShell() {
  const { user } = useAuth();
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const layout = useLayoutConfig();

  const [activeUnidade, setActiveUnidade] = useState<Unidade | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ACTIVE);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const carregarUnidades = async () => {
    try {
      setLoading(true);
      const data = await UnidadesAPI.listar();
      setUnidades(data);
      if (activeUnidade) {
        const stillExists = data.find(u => u.id === activeUnidade.id);
        if (!stillExists) setActiveUnidade(null);
        else setActiveUnidade(stillExists);
      }
    } catch (err: unknown) {
      console.error('Erro ao carregar unidades:', err);
      setError('Falha ao conectar com o banco de dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) carregarUnidades();
  }, [user]);

  useEffect(() => {
    if (activeUnidade) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(activeUnidade));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    }
  }, [activeUnidade]);

  // Injeta cores do layout como CSS custom properties
  useEffect(() => {
    const root = document.documentElement;
    const menuEscuro = !isLightColor(layout.corFundoMenu);

    root.style.setProperty('--background', hexToHsl(layout.corFundo));
    root.style.setProperty('--card',    hexToHsl(layout.corFundoContainers));
    root.style.setProperty('--popover', hexToHsl(layout.corFundoContainers));
    root.style.setProperty('--sidebar-background', hexToHsl(layout.corFundoMenu));
    root.style.setProperty('--sidebar-foreground', menuEscuro ? '213 31% 95%' : '222 47% 11%');
    root.style.setProperty('--sidebar-border',     menuEscuro ? '216 34% 17%' : '214 20% 88%');
    root.style.setProperty('--sidebar-accent',     menuEscuro ? '217 33% 17%' : '210 20% 93%');
    root.style.setProperty('--sidebar-accent-foreground', menuEscuro ? '213 31% 95%' : '222 47% 11%');
  }, [layout.corFundoMenu, layout.corFundo, layout.corFundoContainers]);

  const accentColor = activeUnidade?.cor || '#6366f1';

  return (
    <SidebarProvider style={{ '--sidebar-width': '16.5rem' } as React.CSSProperties}>
      <AppSidebar
        activeUnidade={activeUnidade}
        accentColor={accentColor}
        layout={layout}
      />

      <SidebarInset className="bg-sidebar">
        <div className="flex flex-1 flex-col min-h-screen rounded-l-2xl bg-background text-foreground shadow-lg overflow-hidden">
          <TopBar
            activeUnidade={activeUnidade}
            unidades={unidades}
            onSelectUnidade={setActiveUnidade}
            accentColor={accentColor}
          />
          {error && (
            <div className="p-8">
              <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-50 px-5 py-4 text-red-700 text-sm">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            </div>
          )}

          {!loading && (
            <div className="flex-1 overflow-auto">
              <Routes>
                {/* Dashboard e paginas de leitura — viewer+ */}
                <Route path="/" element={
                  <ProtectedRoute minRole="viewer">
                    <DashboardPage activeUnidade={activeUnidade} unidades={unidades} accentColor={accentColor} />
                  </ProtectedRoute>
                } />
                <Route path="/planejamento" element={
                  <ProtectedRoute minRole="viewer">
                    <PlanejamentoPage unidades={unidades} activeUnidade={activeUnidade} accentColor={accentColor} />
                  </ProtectedRoute>
                } />
                <Route path="/categorias" element={
                  <ProtectedRoute minRole="viewer">
                    <CategoriasPage unidades={unidades} accentColor={accentColor} />
                  </ProtectedRoute>
                } />

                {/* Gestao — admin+ */}
                <Route path="/unidades" element={
                  <ProtectedRoute minRole="admin">
                    <UnidadesPage unidades={unidades} onUpdateUnidades={carregarUnidades} accentColor={accentColor} />
                  </ProtectedRoute>
                } />
                <Route path="/configuracoes" element={<Navigate to="/configuracoes/layout" replace />} />
                <Route path="/configuracoes/layout" element={
                  <ProtectedRoute minRole="admin">
                    <ConfiguracoesPage accentColor={accentColor} onLayoutSaved={layout.refresh} />
                  </ProtectedRoute>
                } />
                <Route path="/configuracoes/graficos" element={
                  <ProtectedRoute minRole="admin">
                    <ConfiguracoesGraficosPage accentColor={accentColor} />
                  </ProtectedRoute>
                } />
                <Route path="/configuracoes/sincronizar" element={
                  <ProtectedRoute minRole="admin">
                    <ConfiguracoesSyncPage unidades={unidades} accentColor={accentColor} />
                  </ProtectedRoute>
                } />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ── Shell super admin (apenas empresas + usuarios) ──────────

function SuperAdminShell() {
  return (
    <SidebarProvider style={{ '--sidebar-width': '16.5rem' } as React.CSSProperties}>
      <SuperAdminSidebar />
      <SidebarInset className="bg-sidebar">
        <div className="flex flex-1 flex-col min-h-screen rounded-l-2xl bg-background text-foreground shadow-lg overflow-hidden">
          <div className="flex-1 overflow-auto">
            <Routes>
              <Route path="/empresas" element={<AdminEmpresasPage />} />
              <Route path="/usuarios" element={<AdminUsuariosPage />} />
              <Route path="*" element={<Navigate to="/empresas" replace />} />
            </Routes>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

// ── Roteador raiz ────────────────────────────────────────────

function RootRouter() {
  const { user, loading, isSuperAdmin } = useAuth();

  if (loading) return null; // AuthProvider mostra loader

  return (
    <Routes>
      {/* Login — redireciona para / se ja autenticado */}
      <Route
        path="/login"
        element={user ? <Navigate to={isSuperAdmin ? '/empresas' : '/'} replace /> : <LoginPage />}
      />
      {/* Super admin: shell dedicada */}
      {user && isSuperAdmin && (
        <Route path="/*" element={<SuperAdminShell />} />
      )}
      {/* Usuarios regulares: AppShell com EmpresaConfig */}
      <Route path="/*" element={
        user
          ? <EmpresaConfigProvider><AppShell /></EmpresaConfigProvider>
          : <Navigate to="/login" replace />
      } />
    </Routes>
  );
}

// ── App raiz ─────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <RootRouter />
          <Toaster
            theme="light"
            position="top-right"
            toastOptions={{
              style: { background: '#ffffff', border: '1px solid hsl(214 20% 88%)', color: 'hsl(222 47% 11%)' },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
