'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAccountMenuItems, useUserIdentity } from './UserAccountMenuItems';

/**
 * spec-54 gap fix — operations roles (driver, warehouse) get the bottom
 * `MobileTabBar` instead of the hamburger, so they never reach the sidebar
 * and its `SidebarUserMenu`. That left phones with no way to sign out.
 *
 * `lg:hidden`: the desktop sidebar already renders `SidebarUserMenu` at
 * every width `lg` and up, so this trigger only needs to exist below that
 * breakpoint — showing both would put two identical logout menus on screen.
 *
 * The 44px trigger is a CSS size (h-11 w-11), not a viewport check — no
 * `matchMedia`/`useViewport`, so no hydration mismatch.
 */
export function TopBarUserMenu() {
  const { email, initials } = useUserIdentity();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={email ? `Cuenta de ${email}` : 'Cuenta'}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-raised lg:hidden"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-text">
            {initials}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-48">
        <UserAccountMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
