'use client';

import { useGlobal } from '@/lib/context/GlobalContext';
import { createSPASassClient } from '@/lib/supabase/client';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { LogOut, Settings, Key } from 'lucide-react';
import Link from 'next/link';

/**
 * spec-54 gap fix — account controls (identity, settings, logout) used to
 * live only inside `SidebarUserMenu`. Operations roles reach the topbar
 * (mobile tab bar) but never the sidebar, so this content is extracted here
 * and shared by both `SidebarUserMenu` and `TopBarUserMenu` — one logout
 * flow, two triggers, instead of two copies that can drift.
 */

export function useUserIdentity() {
  const { user } = useGlobal();
  const email = user?.email ?? '';
  const initials = email.slice(0, 2).toUpperCase();
  return { email, initials };
}

export async function logoutUser() {
  try {
    const client = await createSPASassClient();
    await client.logout();
  } catch (error) {
    console.error('Error logging out:', error);
  }
}

/** The menu body — drop inside any `<DropdownMenuContent>`. */
export function UserAccountMenuItems() {
  const { email } = useUserIdentity();

  return (
    <>
      <div className="px-2 py-1.5 text-xs text-text-muted">{email}</div>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/app/user-settings">
          <Settings className="h-3.5 w-3.5 mr-2" />
          Perfil
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/auth/forgot-password">
          <Key className="h-3.5 w-3.5 mr-2" />
          Cambiar Clave
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={logoutUser} className="text-status-error">
        <LogOut className="h-3.5 w-3.5 mr-2" />
        Cerrar Sesion
      </DropdownMenuItem>
    </>
  );
}
