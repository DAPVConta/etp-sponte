import { LayoutDashboard, Building2, ChevronRight, GraduationCap, Tag, Target } from 'lucide-react';
import type { AppPage, Unidade } from '../types';

interface SidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  activeUnidade: Unidade | null;
  unidades: Unidade[];
  onSelectUnidade: (u: Unidade | null) => void;
}

const navItems: { id: AppPage; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard Financeiro', icon: <LayoutDashboard size={18} /> },
  { id: 'planejamento', label: 'Planejamento', icon: <Target size={18} /> },
  { id: 'categorias', label: 'Categorias de Despesas', icon: <Tag size={18} /> },
  { id: 'unidades', label: 'Cadastro de Unidades', icon: <Building2 size={18} /> },
];


export default function Sidebar({
  currentPage,
  onNavigate,
  activeUnidade,
  unidades,
  onSelectUnidade,
}: SidebarProps) {
  const accentColor = activeUnidade?.cor || '#6366f1';

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo" style={{ justifyContent: 'center', padding: '1rem 0 1.5rem', marginBottom: '0.5rem' }}>
        <img 
          src="/etp-logo.png" 
          alt="ETP Logo" 
          style={{ 
            maxHeight: '52px', 
            width: 'auto', 
            filter: 'brightness(0) invert(1) opacity(0.9)', 
            objectFit: 'contain'
          }} 
        />
      </div>

      {/* Unit selector */}
      {unidades.length > 0 && (
        <div className="sidebar-unit-section">
          <p className="sidebar-section-label">Unidade Ativa</p>
          <div className="sidebar-unit-list">
            <button
              className={`sidebar-unit-item ${activeUnidade === null ? 'active' : ''}`}
              onClick={() => onSelectUnidade(null)}
              style={activeUnidade === null ? { borderColor: '#6366f144', background: '#6366f111' } : {}}
            >
              <span
                className="unit-dot"
                style={{ background: '#6366f1' }}
              />
              <span>Todas as Unidades</span>
            </button>
            {unidades.map(u => (
              <button
                key={u.id}
                className={`sidebar-unit-item ${activeUnidade?.id === u.id ? 'active' : ''}`}
                onClick={() => onSelectUnidade(u)}
                style={
                  activeUnidade?.id === u.id
                    ? { borderColor: `${u.cor}44`, background: `${u.cor}11` }
                    : {}
                }
              >
                <span
                  className="unit-dot"
                  style={{ background: u.cor }}
                />
                <span className="unit-item-name">{u.nome}</span>
                {activeUnidade?.id === u.id && (
                  <ChevronRight size={14} style={{ marginLeft: 'auto', color: u.cor }} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        <p className="sidebar-section-label">Menu</p>
        {navItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            style={
              currentPage === item.id
                ? {
                    background: `${accentColor}18`,
                    borderLeft: `3px solid ${accentColor}`,
                    color: accentColor,
                  }
                : {}
            }
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Active unit color strip at the bottom */}
      {activeUnidade && (
        <div className="sidebar-footer">
          <div
            className="sidebar-unit-badge"
            style={{ background: `${activeUnidade.cor}22`, borderColor: `${activeUnidade.cor}44` }}
          >
            <span className="unit-dot" style={{ background: activeUnidade.cor }} />
            <span style={{ color: activeUnidade.cor, fontWeight: 600 }}>{activeUnidade.nome}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
