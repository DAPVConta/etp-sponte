import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  ChevronRight,
  Tag,
  Target,
  Receipt,
  DollarSign,
  LineChart,
  Settings,
  Palette,
  BarChart3,
  RefreshCw,
  LogOut,
  User,
} from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { cn } from '@/lib/utils';
import type { Unidade } from '../types';
import type { LayoutConfig } from '@/hooks/use-layout-config';
import { useAuth } from '../contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

// ── Props ────────────────────────────────────────────────────────

interface AppSidebarProps {
  activeUnidade: Unidade | null;
  accentColor: string;
  layout: LayoutConfig;
}

// ── Dados de navegação ───────────────────────────────────────────

const cpSubItems = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/lancamento-cp', label: 'Lançamentos', icon: Receipt },
  { to: '/categorias', label: 'Categorias', icon: Tag },
];

const crSubItems = [
  { to: '/dashboard-receitas', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/lancamento-cr', label: 'Lançamentos', icon: Receipt },
  { to: '/categorias-receitas', label: 'Categorias', icon: Tag },
];

const cadastroItems = [
  { to: '/unidades', label: 'Unidades', icon: Building2 },
];

const configSubItems = [
  { to: '/configuracoes/layout', label: 'Layout', icon: Palette },
  { to: '/configuracoes/graficos', label: 'Gráficos', icon: BarChart3 },
  { to: '/configuracoes/sincronizar', label: 'Sincronizar', icon: RefreshCw },
];

// ── Componente auxiliar: NavItem ──────────────────────────────────

function NavItem({
  to,
  end,
  label,
  icon: Icon,
}: {
  to: string;
  end?: boolean;
  label: string;
  icon: React.ElementType;
}) {
  return (
    <SidebarMenuItem>
      <NavLink to={to} end={end}>
        {({ isActive }) => (
          <SidebarMenuButton
            isActive={isActive}
            tooltip={label}
            className={cn(
              'rounded-lg transition-all',
              isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
            )}
          >
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
        )}
      </NavLink>
    </SidebarMenuItem>
  );
}

// ── Componente principal ─────────────────────────────────────────

export default function AppSidebar({
  activeUnidade,
  layout,
}: AppSidebarProps) {
  const location = useLocation();
  const { user, signOut, isAdmin } = useAuth();

  const configOpen = location.pathname.startsWith('/configuracoes');
  const cadastroActive = ['/unidades'].some(p => location.pathname.startsWith(p));
  const cpActive = location.pathname === '/' || ['/lancamento-cp', '/categorias'].some(p => location.pathname.startsWith(p));
  const crActive = ['/dashboard-receitas', '/lancamento-cr', '/categorias-receitas'].some(p => location.pathname.startsWith(p));
  const logoSrc = user?.empresaLogoUrl ?? layout.logoUrl ?? '/etp-logo.png';

  const [cadastroOpen, setCadastroOpen] = useState(true);
  const [configMenuOpen, setConfigMenuOpen] = useState(true);
  const [cpOpen, setCpOpen] = useState(true);
  const [crOpen, setCrOpen] = useState(true);

  return (
    <Sidebar collapsible="none" className="border-r-0">
      {/* ── Logo / Empresa ── */}
      <SidebarHeader className="items-center justify-center py-5 px-4">
        <img
          src={logoSrc}
          alt="Logo"
          className={cn(
            'max-h-[56px] w-auto object-contain',
            !user?.empresaLogoUrl && !layout.logoUrl && 'brightness-0 invert opacity-90'
          )}
        />
        {user?.empresaNomeFantasia && (
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-sidebar-foreground/60 mt-1 text-center truncate w-full">
            {user.empresaNomeFantasia}
          </p>
        )}
      </SidebarHeader>

      <SidebarContent className="px-1">
        {/* ── Planejamento + Contas a Pagar + Contas a Receber ── */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/planejamento" label="Planejamento" icon={Target} />
              <NavItem to="/dashboard-financeiro" label="Dashboard Financeiro" icon={LineChart} />

              {/* Contas a Pagar */}
              <Collapsible.Root open={cpOpen || cpActive} onOpenChange={setCpOpen} className="group/collapsible">
                <SidebarMenuItem>
                  <Collapsible.Trigger asChild>
                    <SidebarMenuButton
                      isActive={cpActive}
                      tooltip="Contas a Pagar"
                      className={cn(
                        'rounded-lg',
                        cpActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                      )}
                    >
                      <Receipt />
                      <span>Contas a Pagar</span>
                      <ChevronRight
                        size={14}
                        className="ml-auto flex-shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                      />
                    </SidebarMenuButton>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <SidebarMenuSub className="border-l-0 mx-0 px-1">
                      {cpSubItems.map(({ to, end, label, icon: Icon }) => (
                        <SidebarMenuSubItem key={to}>
                          <NavLink to={to} end={end}>
                            {({ isActive }) => (
                              <SidebarMenuSubButton
                                asChild
                                isActive={isActive}
                                className={cn(isActive && 'font-semibold text-sidebar-accent-foreground')}
                              >
                                <span className="flex items-center gap-2 w-full">
                                  <Icon size={14} className="flex-shrink-0" />
                                  {label}
                                </span>
                              </SidebarMenuSubButton>
                            )}
                          </NavLink>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </Collapsible.Content>
                </SidebarMenuItem>
              </Collapsible.Root>

              {/* Contas a Receber */}
              <Collapsible.Root open={crOpen || crActive} onOpenChange={setCrOpen} className="group/collapsible">
                <SidebarMenuItem>
                  <Collapsible.Trigger asChild>
                    <SidebarMenuButton
                      isActive={crActive}
                      tooltip="Contas a Receber"
                      className={cn(
                        'rounded-lg',
                        crActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                      )}
                    >
                      <DollarSign />
                      <span>Contas a Receber</span>
                      <ChevronRight
                        size={14}
                        className="ml-auto flex-shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                      />
                    </SidebarMenuButton>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <SidebarMenuSub className="border-l-0 mx-0 px-1">
                      {crSubItems.map(({ to, label, icon: Icon }) => (
                        <SidebarMenuSubItem key={to}>
                          <NavLink to={to}>
                            {({ isActive }) => (
                              <SidebarMenuSubButton
                                asChild
                                isActive={isActive}
                                className={cn(isActive && 'font-semibold text-sidebar-accent-foreground')}
                              >
                                <span className="flex items-center gap-2 w-full">
                                  <Icon size={14} className="flex-shrink-0" />
                                  {label}
                                </span>
                              </SidebarMenuSubButton>
                            )}
                          </NavLink>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </Collapsible.Content>
                </SidebarMenuItem>
              </Collapsible.Root>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* ── Cadastro (apenas admin+) ── */}
        {isAdmin && (
          <SidebarGroup>
            <Collapsible.Root
              open={cadastroOpen || cadastroActive}
              onOpenChange={setCadastroOpen}
              className="group/collapsible"
            >
              <Collapsible.Trigger asChild>
                <SidebarGroupLabel className="uppercase text-[0.65rem] tracking-widest cursor-pointer hover:text-sidebar-foreground transition-colors pr-2">
                  Cadastro
                  <ChevronRight
                    size={12}
                    className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                  />
                </SidebarGroupLabel>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {cadastroItems.map(({ to, label, icon: Icon }) => (
                      <NavItem key={to} to={to} label={label} icon={Icon} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </Collapsible.Content>
            </Collapsible.Root>
          </SidebarGroup>
        )}

        {isAdmin && <SidebarSeparator />}

        {/* ── Configurações ── */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Configurações (apenas admin+) */}
              {isAdmin && (
                <Collapsible.Root open={configMenuOpen || configOpen} onOpenChange={setConfigMenuOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <Collapsible.Trigger asChild>
                      <SidebarMenuButton
                        isActive={configOpen}
                        tooltip="Configurações"
                        className={cn(
                          'rounded-lg',
                          configOpen && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                        )}
                      >
                        <Settings />
                        <span>Configurações</span>
                        <ChevronRight
                          size={14}
                          className="ml-auto flex-shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                        />
                      </SidebarMenuButton>
                    </Collapsible.Trigger>

                    <Collapsible.Content>
                      <SidebarMenuSub className="border-l-0 mx-0 px-1">
                        {configSubItems.map(({ to, label, icon: Icon }) => (
                          <SidebarMenuSubItem key={to}>
                            <NavLink to={to}>
                              {({ isActive }) => (
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={isActive}
                                  className={cn(isActive && 'font-semibold text-sidebar-accent-foreground')}
                                >
                                  <span className="flex items-center gap-2 w-full">
                                    <Icon size={14} className="flex-shrink-0" />
                                    {label}
                                  </span>
                                </SidebarMenuSubButton>
                              )}
                            </NavLink>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </Collapsible.Content>
                  </SidebarMenuItem>
                </Collapsible.Root>
              )}

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: usuario logado + logout ── */}
      <SidebarFooter className="border-t border-sidebar-border">
        {activeUnidade && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-sidebar-accent text-sidebar-accent-foreground text-sm font-semibold mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: activeUnidade.cor, boxShadow: `0 0 8px ${activeUnidade.cor}` }}
            />
            <span className="truncate">{activeUnidade.nome}</span>
          </div>
        )}

        {user && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="w-7 h-7 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
              <User size={13} className="text-sidebar-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.72rem] font-semibold truncate">{user.email}</p>
              <p className="text-[0.62rem] text-sidebar-foreground/50 capitalize">{user.role.replace('_', ' ')}</p>
            </div>
            <button
              onClick={signOut}
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors flex-shrink-0"
              title="Sair"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
