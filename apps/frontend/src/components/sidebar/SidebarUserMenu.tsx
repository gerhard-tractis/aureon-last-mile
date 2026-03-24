'use client';

import { useGlobal } from '@/lib/context/GlobalContext';
import { createSPASassClient } from '@/lib/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, Settings, Key } from 'lucide-react';
import Link from 'next/link';

interface SidebarUserMenuProps {
  pinned: boolean;
}

export function SidebarUserMenu({ pinned }: SidebarUserMenuProps) {
  const { user } = useGlobal();
  const email = user?.email ?? '';
  const initials = email.slice(0, 2).toUpperCase();

  async function handleLogout() {
    try {
      const client = await createSPASassClient();
      await client.logout();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sidebar-text hover:bg-sidebar-hover transition-colors">
          <div className="h-7 w-7 rounded-full bg-sidebar-border flex items-center justify-center text-xs font-semibold text-sidebar-text flex-shrink-0">
            {initials}
          </div>
          {pinned && <span className="text-xs truncate">{email}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-48">
        <div className="px-2 py-1.5 text-xs text-text-muted">{email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/user-settings"><Settings className="h-3.5 w-3.5 mr-2" />Configuracion</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/auth/forgot-password"><Key className="h-3.5 w-3.5 mr-2" />Cambiar Clave</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-status-error">
          <LogOut className="h-3.5 w-3.5 mr-2" />Cerrar Sesion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
