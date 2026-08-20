/**
 * spec-54 phase 2 — the navigation definition.
 *
 * Extracted out of AppLayout so three things can share one source of truth:
 * the sidebar, the topbar breadcrumb, and the tests. Before this, the
 * breadcrumb was hand-written per page and could drift from the nav.
 *
 * The rebrand groups the flat 10-item list into two sections because the
 * shift-paced work (what is queued right now) and the management work (what
 * happened, what is planned) are read at different rhythms.
 */

import {
  ArrowUpDown,
  Calendar,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Radio,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { ModuleKey } from '@/lib/modules/registry';

/** Queue counters shown on OPERACIÓN items. Keyed to useNavCounts. */
export type CountKey = 'pickup' | 'reception' | 'distribution' | 'dispatch';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omitted for items that have no queue of their own. */
  countKey?: CountKey;
  /** Module that must be enabled for the operator (spec-45). */
  module?: ModuleKey;
  /** Visibility given the current user. */
  isVisible: (ctx: NavContext) => boolean;
}

export interface NavSection {
  title: string;
  /** Breadcrumb form — the sidebar heading is uppercase, the crumb is not. */
  crumb: string;
  items: NavItem[];
}

export interface NavContext {
  role: string | null;
  permissions: readonly string[];
  enabledModules: readonly ModuleKey[];
}

const isAdminOrManager = ({ role }: NavContext) =>
  role === 'admin' || role === 'operations_manager';

const hasPermission =
  (...any: string[]) =>
  ({ permissions }: NavContext) =>
    any.some((p) => permissions.includes(p));

export const OPERATION_ITEMS: NavItem[] = [
  {
    href: '/app/operations-control',
    label: 'Torre de control',
    icon: Radio,
    module: ModuleKey.OPS_CONTROL,
    isVisible: isAdminOrManager,
  },
  {
    href: '/app/pickup',
    label: 'Recogida',
    icon: CheckSquare,
    countKey: 'pickup',
    module: ModuleKey.PICKUP,
    isVisible: hasPermission('pickup'),
  },
  {
    href: '/app/reception',
    label: 'Recepción',
    icon: ArrowUpDown,
    countKey: 'reception',
    module: ModuleKey.RECEPTION,
    isVisible: hasPermission('reception'),
  },
  {
    href: '/app/distribution',
    label: 'Distribución',
    icon: Layers,
    countKey: 'distribution',
    module: ModuleKey.DISTRIBUTION,
    isVisible: hasPermission('distribution'),
  },
  {
    href: '/app/dispatch',
    label: 'Despacho',
    icon: Truck,
    countKey: 'dispatch',
    module: ModuleKey.DISPATCH,
    isVisible: hasPermission('dispatch', 'admin'),
  },
];

export const MANAGEMENT_ITEMS: NavItem[] = [
  {
    href: '/app/dashboard',
    label: 'Dashboard ejecutivo',
    icon: LayoutDashboard,
    isVisible: () => true,
  },
  {
    href: '/app/capacity-planning',
    label: 'Capacidad',
    icon: Calendar,
    isVisible: isAdminOrManager,
  },
  {
    href: '/app/conversations',
    label: 'Conversaciones',
    icon: MessageSquare,
    module: ModuleKey.CONVERSATIONS,
    isVisible: (ctx) => isAdminOrManager(ctx) || hasPermission('customer_service')(ctx),
  },
  {
    href: '/app/audit-logs',
    label: 'Auditoría',
    icon: FileText,
    isVisible: isAdminOrManager,
  },
  {
    href: '/admin',
    label: 'Admin',
    icon: ShieldCheck,
    isVisible: ({ role }) => role === 'admin',
  },
];

export const NAV_SECTIONS: NavSection[] = [
  { title: 'OPERACIÓN', crumb: 'Operación', items: OPERATION_ITEMS },
  { title: 'GESTIÓN', crumb: 'Gestión', items: MANAGEMENT_ITEMS },
];

/**
 * Queue size at which a counter flips from neutral to warning.
 *
 * These are per-module because the volumes are not comparable: a distribution
 * backlog of 200 packages is a normal mid-morning, while 200 orders waiting on
 * pickup means nobody has left the hub.
 */
export const countKeyThresholds: Record<CountKey, number> = {
  pickup: 50,
  reception: 50,
  distribution: 250,
  dispatch: 80,
};

/** Sections filtered to what this user may see. Empty sections are dropped. */
export function buildNavSections(ctx: NavContext): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.isVisible(ctx) && (item.module === undefined || ctx.enabledModules.includes(item.module)),
    ),
  })).filter((section) => section.items.length > 0);
}

/**
 * spec-54 — the mobile bottom tab bar.
 *
 * Floor and van roles only. `operations_manager` and `admin` do their work
 * on desktop; a phone in their hand is incidental, and a 4-tab driver bar
 * would hide most of the 9-item nav they actually need — they keep the
 * hamburger `Sheet` instead (see AppLayout).
 *
 * spec-61 — `pickup_leader` belongs here for the same reason `pickup_crew`
 * does: it is a van role. A role missing from this set gets NO tab bar
 * (`buildMobileTabs` returns `[]` below), which on a phone means no
 * navigation at all. Exported so navigation.test.ts can assert the set
 * rather than restate it.
 */
export const OPERATIONS_ROLES = [
  'pickup_crew',
  'pickup_leader',
  'warehouse_staff',
  'loading_crew',
] as const;

const MOBILE_TAB_ROLES: ReadonlySet<string> = new Set(OPERATIONS_ROLES);

export function isOperationsRole(role: string | null): boolean {
  return role !== null && MOBILE_TAB_ROLES.has(role);
}

/** A mobile tab, plus whether the signed-in user may actually open it. */
export interface MobileTab extends NavItem {
  /**
   * True when this user cannot open the tab right now — missing permission,
   * or the operator hasn't enabled the module (spec-45). Renders either way
   * (see MobileTab's consumer): a live link would be a fake destination in
   * both cases — every module page bounces on the client
   * (`_client-gate.tsx`) the instant a permission is missing.
   */
  disabled: boolean;
}

/**
 * Always the same four, same order, for every operations role — Recogida,
 * Recepción, Distribución, Despacho — taken straight from OPERATION_ITEMS so
 * the tab bar can never drift from the sidebar's icons/labels. `Torre de
 * control` is excluded: it's gated by `isAdminOrManager`, never true here.
 *
 * Exactly four, always — never fewer, whatever the permission/module
 * state — marking `disabled` rather than omitting. The permission gate
 * (`isVisible`) and the spec-45 module gate (`enabledModules`) both fold
 * into that one flag: an ops user sees the whole shape of the app, greyed
 * out wherever it isn't theirs, for either reason.
 */
export function buildMobileTabs(ctx: NavContext): MobileTab[] {
  if (!isOperationsRole(ctx.role)) return [];
  return OPERATION_ITEMS.filter((item) => item.href !== '/app/operations-control').map((item) => ({
    ...item,
    disabled: !item.isVisible(ctx) || (item.module !== undefined && !ctx.enabledModules.includes(item.module)),
  }));
}

/**
 * Screens that already own a fixed, full-width action bar pinned to the
 * viewport bottom (a 60px primary button, safe-area padding of their own).
 * Stacking the tab bar under/over one of these would either hide the
 * screen's own button or make the last list row unreachable — so the tab
 * bar (and AppLayout's compensating scroll padding) is suppressed here.
 * The hamburger reappears as the fallback way to leave the screen.
 *
 * `/app/pickup/route/active` is reachable from the Recogida tab (it is not
 * a tab destination itself) and carries the same fixed-footer pattern, so
 * it is listed alongside the two loadId-scoped flows.
 */
const MOBILE_IMMERSIVE_PREFIXES = [
  '/app/pickup/scan',
  '/app/pickup/review',
  '/app/pickup/route/active',
];

export function isImmersiveMobileRoute(pathname: string): boolean {
  return MOBILE_IMMERSIVE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

/**
 * Where a signed-in user starts. Used by `/app` now that the marketing landing
 * page no longer occupies `/`.
 *
 * This is deliberately the first item the sidebar would show rather than a
 * hardcoded route: OPERACIÓN leads with the control tower, so admins and
 * operations managers land there, while a warehouse or driver account — for
 * whom the tower is hidden and would render empty — lands on the first queue
 * it can actually work. Dashboard ejecutivo is visible to everyone, so the
 * fallback is only reached if the nav is ever emptied entirely.
 */
export function resolveLandingPath(ctx: NavContext): string {
  const first = buildNavSections(ctx)[0]?.items[0];
  return first?.href ?? '/app/dashboard';
}

/**
 * Reachable pages that are deliberately not in the sidebar — you arrive at them
 * from a button or a menu, not from the nav. They still need a breadcrumb, and
 * it has to come from here: the topbar is the only place a crumb is rendered,
 * so a route missing from this table simply has no crumb at all.
 */
const EXTRA_CRUMBS: { href: string; section: string; page: string }[] = [
  { href: '/app/orders/new', section: 'Gestión', page: 'Nuevo pedido' },
  { href: '/app/orders/import', section: 'Gestión', page: 'Importar pedidos' },
  { href: '/app/user-settings', section: 'Gestión', page: 'Mi cuenta' },
];

/**
 * Breadcrumb for a pathname, from the same definition the sidebar uses, so the
 * two cannot disagree. Matches the longest href prefix, which is what keeps
 * `/admin/users` on Admin rather than on a shorter accidental match, and what
 * lets `/app/orders/new` beat a hypothetical `/app/orders` nav item.
 */
export function breadcrumbForPath(pathname: string): { section: string; page: string } | null {
  let best: { section: string; page: string; length: number } | null = null;

  const candidates = [
    ...NAV_SECTIONS.flatMap((section) =>
      section.items.map((item) => ({
        href: item.href,
        section: section.crumb,
        page: item.label,
      })),
    ),
    ...EXTRA_CRUMBS,
  ];

  for (const candidate of candidates) {
    const matches = pathname === candidate.href || pathname.startsWith(candidate.href + '/');
    if (!matches) continue;
    if (best && candidate.href.length <= best.length) continue;
    best = { section: candidate.section, page: candidate.page, length: candidate.href.length };
  }

  return best ? { section: best.section, page: best.page } : null;
}
