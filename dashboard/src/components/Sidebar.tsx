import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, ChevronRight, Tag, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Unidade } from '../types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface SidebarProps {
  activeUnidade: Unidade | null;
  unidades: Unidade[];
  onSelectUnidade: (u: Unidade | null) => void;
  accentColor: string;
}

const navItems = [
  { to: '/', label: 'Dashboard Financeiro', icon: LayoutDashboard },
  { to: '/planejamento', label: 'Planejamento', icon: Target },
  { to: '/categorias', label: 'Categorias de Despesas', icon: Tag },
  { to: '/unidades', label: 'Cadastro de Unidades', icon: Building2 },
];

export default function Sidebar({ activeUnidade, unidades, onSelectUnidade, accentColor }: SidebarProps) {
  return (
    <aside className="dark fixed top-0 left-0 bottom-0 w-[270px] z-50 flex flex-col border-r border-border/50 bg-background/95 backdrop-blur-xl pt-[3px]">
      {/* subtle right edge gradient */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-primary/15 to-transparent" />

      {/* Logo */}
      <div className="flex items-center justify-center px-5 py-4 border-b border-border/50">
        <img
          src="/etp-logo.png"
          alt="ETP"
          className="max-h-[52px] w-auto object-contain brightness-0 invert opacity-90"
        />
      </div>

      <ScrollArea className="flex-1">
        {/* Unit selector */}
        {unidades.length > 0 && (
          <div className="py-3">
            <p className="px-5 mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Unidade Ativa
            </p>
            <div className="flex flex-col gap-0.5 px-3">
              <button
                onClick={() => onSelectUnidade(null)}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border text-sm text-left transition-all duration-200',
                  activeUnidade === null
                    ? 'border-primary/30 bg-primary/8 text-foreground font-medium'
                    : 'border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                )}
              >
                <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 shadow-[0_0_6px_currentColor]" />
                <span>Todas as Unidades</span>
              </button>

              {unidades.map(u => (
                <button
                  key={u.id}
                  onClick={() => onSelectUnidade(u)}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border text-sm text-left transition-all duration-200',
                    activeUnidade?.id === u.id
                      ? 'text-foreground font-medium'
                      : 'border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  )}
                  style={
                    activeUnidade?.id === u.id
                      ? { borderColor: `${u.cor}44`, background: `${u.cor}11` }
                      : {}
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_6px_currentColor]"
                    style={{ background: u.cor, color: u.cor }}
                  />
                  <span className="flex-1 truncate">{u.nome}</span>
                  {activeUnidade?.id === u.id && (
                    <ChevronRight size={14} style={{ color: u.cor }} className="flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <Separator className="mx-3 w-auto" />

        {/* Navigation */}
        <nav className="py-3">
          <p className="px-5 mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Menu
          </p>
          <div className="flex flex-col gap-0.5 px-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-[0.7rem] rounded-lg border-l-[3px] text-sm transition-all duration-200',
                    isActive
                      ? 'font-semibold'
                      : 'border-l-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                  )
                }
                style={({ isActive }) =>
                  isActive
                    ? {
                        background: `${accentColor}18`,
                        borderLeftColor: accentColor,
                        color: accentColor,
                      }
                    : {}
                }
              >
                <Icon size={18} className="flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </ScrollArea>

      {/* Active unit footer */}
      {activeUnidade && (
        <div className="p-3 border-t border-border/50">
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-all duration-300"
            style={{
              background: `${activeUnidade.cor}22`,
              borderColor: `${activeUnidade.cor}44`,
              color: activeUnidade.cor,
            }}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_6px_currentColor]"
              style={{ background: activeUnidade.cor }}
            />
            <span className="truncate">{activeUnidade.nome}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
