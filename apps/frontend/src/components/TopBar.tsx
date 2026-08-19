'use client';

import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { breadcrumbForPath } from './sidebar/navigation';
import ThemeToggle from './ThemeToggle';
import { SyncChip } from './SyncChip';
import CapacityAlertBell from './capacity/CapacityAlertBell';
import { TopBarUserMenu } from './user-menu/TopBarUserMenu';

/**
 * spec-54 phase 2 — the 56px application topbar.
 *
 * Replaces the floating `absolute top-3 right-4` cluster, which overlapped page
 * content and only existed on desktop. Everything global now has one home, at
 * every breakpoint: where you are, how to search, which theme, sync state,
 * alerts.
 */

interface TopBarProps {
  /** Hamburger for the sheet sidebar; rendered below `lg` only. */
  menuSlot?: React.ReactNode;
  onOpenSearch?: () => void;
  /** Search, bell and inspector are ops-manager surfaces. */
  showOpsTools?: boolean;
  operatorId?: string | null;
}

function Breadcrumb() {
  const pathname = usePathname();
  const crumb = breadcrumbForPath(pathname ?? '');

  if (!crumb) return <div />;

  return (
    <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
      <span className="hidden truncate sm:inline">{crumb.section}</span>
      <span className="hidden sm:inline" aria-hidden="true">
        /
      </span>
      <span className="truncate font-semibold text-text">{crumb.page}</span>
    </nav>
  );
}

export function TopBar({
  menuSlot,
  onOpenSearch,
  showOpsTools = false,
  operatorId = null,
}: TopBarProps) {
  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
      {menuSlot}
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-2.5">
        {showOpsTools && onOpenSearch && (
          <button
            aria-label="Buscar orden o paquete"
            onClick={onOpenSearch}
            className="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong lg:w-[270px] lg:px-3"
          >
            <Search className="h-3.5 w-3.5 flex-none" />
            {/* The full prompt is the affordance on desktop; on a narrow topbar
                it collapses to the icon rather than being dropped, so the
                shortcut stays discoverable. */}
            <span className="hidden lg:inline">Buscar orden, paquete o RUT…</span>
            <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] lg:inline">
              /
            </kbd>
          </button>
        )}

        <ThemeToggle />

        {/* Sync state lives here rather than in a fixed banner over the page —
            see SyncChip. It renders nothing while online and drained. */}
        <SyncChip />

        {showOpsTools && <CapacityAlertBell operatorId={operatorId} />}

        {/* The desktop sidebar already renders SidebarUserMenu at `lg` and
            up (see AppLayout) — this trigger is `lg:hidden` internally so
            phones and tablets never lose account access, and desktop never
            shows the menu twice. */}
        <TopBarUserMenu />
      </div>
    </header>
  );
}

export default TopBar;
