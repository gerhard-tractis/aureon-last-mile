'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildMobileTabs,
  isImmersiveMobileRoute,
  type MobileTab,
  type NavContext,
} from './sidebar/navigation';

/**
 * spec-54 — the mobile bottom tab bar (mock 1g), rebuilt for the floor/van
 * roles rather than the driver-only mock. An operations role always gets
 * exactly four tabs — Recogida · Recepción · Distribución · Despacho — this
 * invariant holds whatever the permissions or spec-45 module state is (see
 * `buildMobileTabs`). `operations_manager`/`admin`/unrecognised roles get
 * nothing here and keep AppLayout's hamburger `Sheet`.
 *
 * A tab the user cannot open — missing permission, or the operator hasn't
 * enabled the module — still renders, as `TabDisabled`: a `<span>`, never a
 * `<Link>`, so it carries no `href` and is not in the tab order. An ops
 * user should see the shape of the app, marked wherever it isn't theirs,
 * rather than a shorter bar with no explanation.
 *
 * The muted tone alone (`text-text-muted`, no opacity stacked on top —
 * opacity compositing it further over `bg-surface` dropped it to ~1.7:1 in
 * light mode, unreadable) is not the disabled signal by itself: a small
 * `Lock` badges the tab's icon, a cue that survives a greyscale screenshot
 * and does not rely on colour at all. `aria-disabled="true"` plus the
 * `sr-only` " — sin acceso" tells a screen reader why the item does
 * nothing, rather than leaving it to encounter a dead item.
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
      {tabs.map((tab) =>
        tab.disabled ? (
          <TabDisabled key={tab.href} tab={tab} />
        ) : (
          <TabLink key={tab.href} tab={tab} active={pathname === tab.href || pathname.startsWith(tab.href + '/')} />
        ),
      )}
    </nav>
  );
}

const TAB_LAYOUT =
  'flex min-h-[44px] flex-1 flex-col items-center justify-start gap-1 pt-[9px] px-2 pb-[max(22px,env(safe-area-inset-bottom))]';

function TabLink({ tab, active }: { tab: MobileTab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={cn(TAB_LAYOUT, active ? 'font-semibold text-accent-emphasis' : 'font-medium text-text-secondary')}
    >
      <Icon className="h-[21px] w-[21px]" aria-hidden="true" />
      <span className="text-[10px] leading-none">{tab.label}</span>
    </Link>
  );
}

/**
 * Not a link: no `href`, not in the tab order, ignores clicks by virtue of
 * being a plain `<span>` rather than by disabling a focusable element (a
 * `pointer-events-none` `<Link>` would still be reachable by keyboard).
 */
function TabDisabled({ tab }: { tab: MobileTab }) {
  const Icon = tab.icon;
  return (
    <span aria-disabled="true" className={cn(TAB_LAYOUT, 'font-medium text-text-muted')}>
      <span className="relative flex h-[21px] w-[21px] items-center justify-center">
        <Icon className="h-[21px] w-[21px]" aria-hidden="true" />
        {/* Non-colour "no access" cue — a locked padlock badged on the icon's
            corner, backed by the bar's own surface so it reads as a cutout
            rather than overlapping strokes. */}
        <Lock
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-surface p-[1px] text-text-muted"
          aria-hidden="true"
        />
      </span>
      <span className="text-[10px] leading-none">
        {tab.label}
        <span className="sr-only"> — sin acceso</span>
      </span>
    </span>
  );
}
