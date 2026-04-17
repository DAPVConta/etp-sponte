import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, User, LogOut, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Unidade } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface TopBarProps {
  activeUnidade: Unidade | null;
  unidades: Unidade[];
  onSelectUnidade: (u: Unidade | null) => void;
  accentColor: string;
}

interface DropdownPos {
  top: number;
  right: number;
}

export default function TopBar({
  activeUnidade,
  unidades,
  onSelectUnidade,
  accentColor,
}: TopBarProps) {
  const { user, signOut } = useAuth();
  const [search, setSearch] = useState('');
  const [unidadeOpen, setUnidadeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unidadePos, setUnidadePos] = useState<DropdownPos | null>(null);
  const [profilePos, setProfilePos] = useState<DropdownPos | null>(null);

  const unidadeBtnRef = useRef<HTMLButtonElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const unidadePanelRef = useRef<HTMLDivElement>(null);
  const profilePanelRef = useRef<HTMLDivElement>(null);

  // Calcula posicao do dropdown quando abre
  useEffect(() => {
    if (unidadeOpen && unidadeBtnRef.current) {
      const r = unidadeBtnRef.current.getBoundingClientRect();
      setUnidadePos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
  }, [unidadeOpen]);

  useEffect(() => {
    if (profileOpen && profileBtnRef.current) {
      const r = profileBtnRef.current.getBoundingClientRect();
      setProfilePos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
  }, [profileOpen]);

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        unidadeOpen &&
        !unidadeBtnRef.current?.contains(target) &&
        !unidadePanelRef.current?.contains(target)
      ) {
        setUnidadeOpen(false);
      }
      if (
        profileOpen &&
        !profileBtnRef.current?.contains(target) &&
        !profilePanelRef.current?.contains(target)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [unidadeOpen, profileOpen]);

  const roleLabel = user?.role.replace('_', ' ') ?? '';

  return (
    <header className="flex items-center gap-3 px-5 h-14 border-b border-border/60 bg-card/50 backdrop-blur-sm flex-shrink-0">
      {/* Busca */}
      <div className="relative flex items-center flex-1 max-w-md">
        <Search
          size={15}
          className="absolute left-3 text-muted-foreground pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar..."
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
        />
      </div>

      <div className="flex-1" />

      {/* Seletor de unidade */}
      {unidades.length > 0 && (
        <>
          <button
            ref={unidadeBtnRef}
            className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold transition-all hover:brightness-105"
            style={{
              background: `${accentColor}14`,
              color: accentColor,
              border: `1px solid ${accentColor}30`,
            }}
            onClick={() => setUnidadeOpen((o) => !o)}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                background: activeUnidade?.cor ?? accentColor,
                boxShadow: activeUnidade
                  ? `0 0 6px ${activeUnidade.cor}`
                  : 'none',
              }}
            />
            <span className="truncate max-w-[160px]">
              {activeUnidade ? activeUnidade.nome : 'Todas as Unidades'}
            </span>
            <ChevronDown size={13} />
          </button>

          {unidadeOpen && unidadePos && createPortal(
            <div
              ref={unidadePanelRef}
              className="fixed bg-popover border border-border rounded-xl p-1.5 z-[100] min-w-[220px] shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
              style={{ top: unidadePos.top, right: unidadePos.right }}
            >
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                  !activeUnidade
                    ? 'bg-primary/15 text-primary font-semibold'
                    : 'text-foreground hover:bg-black/5'
                )}
                onClick={() => {
                  onSelectUnidade(null);
                  setUnidadeOpen(false);
                }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-muted-foreground/50" />
                Todas as Unidades
                {!activeUnidade && <Check size={13} className="ml-auto" />}
              </button>
              {unidades.map((u) => (
                <button
                  key={u.id}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                    activeUnidade?.id === u.id
                      ? 'bg-primary/15 text-primary font-semibold'
                      : 'text-foreground hover:bg-black/5'
                  )}
                  onClick={() => {
                    onSelectUnidade(u);
                    setUnidadeOpen(false);
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: u.cor }}
                  />
                  <span className="truncate">{u.nome}</span>
                  {activeUnidade?.id === u.id && (
                    <Check size={13} className="ml-auto" />
                  )}
                </button>
              ))}
            </div>,
            document.body
          )}
        </>
      )}

      {/* Perfil do usuario */}
      {user && (
        <>
          <button
            ref={profileBtnRef}
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
            title={user.email}
          >
            <User size={16} />
          </button>

          {profileOpen && profilePos && createPortal(
            <div
              ref={profilePanelRef}
              className="fixed bg-popover border border-border rounded-xl p-1.5 z-[100] min-w-[240px] shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
              style={{ top: profilePos.top, right: profilePos.right }}
            >
              <div className="px-3 py-2 border-b border-border/60 mb-1">
                <p className="text-sm font-semibold text-foreground truncate">
                  {user.email}
                </p>
                <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground capitalize mt-0.5">
                  <Shield size={11} />
                  {roleLabel}
                </p>
                {user.empresaNomeFantasia && (
                  <p className="text-[0.7rem] text-muted-foreground truncate mt-0.5">
                    {user.empresaNomeFantasia}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setProfileOpen(false);
                  signOut();
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-sm text-foreground hover:bg-black/5 transition-colors"
              >
                <LogOut size={14} />
                Sair
              </button>
            </div>,
            document.body
          )}
        </>
      )}
    </header>
  );
}
