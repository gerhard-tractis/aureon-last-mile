'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  buildMobileTabs,
  isImmersiveMobileRoute,
  type NavContext,
} from './sidebar/navigation';

/**
 * spec-54 — the mobile bottom tab bar (mock 1g), rebuilt for the floor/van
 * roles rather than the driver-only mock: same four tabs for every
 * operations role — Recogida · Recepción · Distribución · Despacho — each
 * gated by the identical permission + module rules the sidebar uses (see
 * `buildMobileTabs`). `operations_manager`/`admin`/unrecognised roles get
 * nothing here and keep AppLayout's hamburger `Sheet`.
 *
 * Purely `lg:hidden` — no JS viewport check. `matchMedia` does not exist
 * during SSR, and a sibling screen just shipped a hydration bug from doing
 * exactly that; this component renders identically on the server and on
 * first client paint, and only CSS decides whether it is visible.
 */
export function MobileTabBar({ ctx }: { ctx: NavContext }) {
  const pathname = usePathname();
  const tabs = buildMobileTabs(ctx);

  if (tabs.length === 0 || isImmersiveMobileRoute(pathname)) return null;

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--mobile-tabbar-h)] border-t border-border bg-surface lg:hidden"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-start gap-1',
              'pt-[9px] px-2 pb-[max(22px,env(safe-area-inset-bottom))]',
              active ? 'font-semibold text-accent-emphasis' : 'font-medium text-text-secondary',
            )}
          >
            <Icon className="h-[21px] w-[21px]" aria-hidden="true" />
            <span className="text-[10px] leading-none">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
