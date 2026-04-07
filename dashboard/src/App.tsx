import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './pages/DashboardPage';
import UnidadesPage from './pages/UnidadesPage';
import CategoriasPage from './pages/CategoriasPage';
import PlanejamentoPage from './pages/PlanejamentoPage';
import type { AppPage, Unidade } from './types';
import './index.css';
import { UnidadesAPI } from './api/unidades';

const STORAGE_KEY_ACTIVE = 'etp_active_unidade';

export default function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('dashboard');
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

  // Carregar unidades do Supabase
  const carregarUnidades = async () => {
    try {
      setLoading(true);
      const data = await UnidadesAPI.listar();
      setUnidades(data);
      // Atualizar o ativo se ainda existir, ou limpar
      if (activeUnidade) {
        const stillExists = data.find(u => u.id === activeUnidade.id);
        if (!stillExists) setActiveUnidade(null);
        else setActiveUnidade(stillExists);
      }
    } catch (err: any) {
      console.error('Erro ao carregar unidades:', err);
      setError('Falha ao conectar com o banco de dados. Verifique suas credenciais do Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarUnidades();
  }, []);

  // Persistir unidade ativa localmente (apenas o ID ou objeto)
  useEffect(() => {
    if (activeUnidade) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(activeUnidade));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    }
  }, [activeUnidade]);

  const accentColor = activeUnidade?.cor || '#6366f1';

  return (
    <div className="app-shell">
      <div className="accent-topbar" style={{ background: accentColor }} />

      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        activeUnidade={activeUnidade}
        unidades={unidades}
        onSelectUnidade={setActiveUnidade}
      />

      <main className="main-content">
        {error && (
          <div style={{ padding: '2rem' }}>
            <div className="error-banner">
              <span>{error}</span>
            </div>
          </div>
        )}

        {currentPage === 'dashboard' && !loading && (
          <DashboardPage activeUnidade={activeUnidade} accentColor={accentColor} />
        )}
        
        {currentPage === 'categorias' && !loading && (
          <CategoriasPage
            unidades={unidades}
            accentColor={accentColor}
          />
        )}

        {currentPage === 'unidades' && (
          <UnidadesPage
            unidades={unidades}
            onUpdateUnidades={carregarUnidades}
            accentColor={accentColor}
          />
        )}

        {currentPage === 'planejamento' && !loading && (
          <PlanejamentoPage
            unidades={unidades}
            accentColor={accentColor}
          />
        )}
      </main>
    </div>
  );
}
