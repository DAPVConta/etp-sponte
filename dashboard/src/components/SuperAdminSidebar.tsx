import { NavLink } from 'react-router-dom';
import { Building2, Users, ShieldCheck, LogOut, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

const navItems = [
  { to: '/empresas', label: 'Empresas', icon: Building2 },
  { to: '/usuarios', label: 'Usuários', icon: Users },
];

export default function SuperAdminSidebar() {
  const { user, signOut } = useAuth();

  return (
    <Sidebar collapsible="none" className="border-r-0">
      {/* Header */}
      <SidebarHeader className="items-center justify-center py-5 px-4">
        <img
          src="/etp-logo.png"
          alt="Logo"
          className="max-h-[56px] w-auto object-contain brightness-0 invert opacity-90"
        />
        <span className="mt-2 text-[0.6rem] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-1">
          <ShieldCheck size={10} /> Super Admin
        </span>
      </SidebarHeader>

      <SidebarSeparator />

      {/* Nav */}
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <NavLink to={to}>
                    {({ isActive }) => (
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={label}
                        className={cn(
                          'rounded-lg transition-all',
                          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold',
                        )}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        {user && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="w-7 h-7 rounded-full bg-sidebar-accent flex items-center justify-center flex-shrink-0">
              <User size={13} className="text-sidebar-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[0.72rem] font-semibold truncate">{user.email}</p>
              <p className="text-[0.62rem] text-sidebar-foreground/50">Super Admin</p>
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
