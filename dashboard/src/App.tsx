import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import UnidadesPage from './pages/UnidadesPage';
import CategoriasPage from './pages/CategoriasPage';
import PlanejamentoPage from './pages/PlanejamentoPage';
import type { Unidade } from './types';
import './index.css';
import { UnidadesAPI } from './api/unidades';
import { AlertCircle } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

const STORAGE_KEY_ACTIVE = 'etp_active_unidade';

function AppShell() {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      setError('Falha ao conectar com o banco de dados. Verifique suas credenciais do Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregarUnidades(); }, []);

  useEffect(() => {
    if (activeUnidade) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(activeUnidade));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    }
  }, [activeUnidade]);

  const accentColor = activeUnidade?.cor || '#6366f1';

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* accent topbar */}
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-[100] transition-all duration-400"
        style={{ background: accentColor, boxShadow: `0 1px 12px ${accentColor}4d` }}
      />

      <Sidebar
        activeUnidade={activeUnidade}
        unidades={unidades}
        onSelectUnidade={setActiveUnidade}
        accentColor={accentColor}
      />

      <main className="ml-[270px] flex-1 min-h-screen pt-[3px]">
        {error && (
          <div className="p-8">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-50 px-5 py-4 text-red-700 text-sm">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && (
          <Routes>
            <Route path="/" element={<DashboardPage activeUnidade={activeUnidade} accentColor={accentColor} />} />
            <Route path="/planejamento" element={<PlanejamentoPage unidades={unidades} accentColor={accentColor} />} />
            <Route path="/categorias" element={<CategoriasPage unidades={unidades} accentColor={accentColor} />} />
            <Route path="/unidades" element={<UnidadesPage unidades={unidades} onUpdateUnidades={carregarUnidades} accentColor={accentColor} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell />
        <Toaster
          theme="light"
          position="top-right"
          toastOptions={{
            style: { background: '#ffffff', border: '1px solid hsl(214 20% 88%)', color: 'hsl(222 47% 11%)' },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
