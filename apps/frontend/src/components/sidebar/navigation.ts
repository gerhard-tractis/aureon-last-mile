/**
 * spec-54 phase 2 — the navigation definition.
 *
 * Extracted out of AppLayout so three things can share one source of truth:
 * the sidebar, the topbar breadcrumb, and the tests. Before this, the
 * breadcrumb was hand-written per page and could drift from the nav.
 *
 * spec-67 cuts the nav into THREE sections by reading rhythm, not by object
 * type. SEGUIMIENTO is transversal and live (the whole operation, then one
 * order, then one customer); OPERACION is the shift's four stations in
 * physical flow order; GESTION is what is planned and what is accounted for.
 *
 * The membership rule for OPERACION is one-directional and testable: every
 * item there has BOTH `module` and `countKey`. The converse is deliberately
 * NOT true -- `Pedidos` keeps `countKey: 'orders'` from inside SEGUIMIENTO.
 *
 * spec-65 Task 3: this file holds only the nav definition proper — sections,
 * items, visibility, landing path. The mobile tab bar lives in
 * navigation.mobile.ts and the breadcrumb in navigation.breadcrumbs.ts, both
 * re-exported below, so this file stays under the project's 300-line
 * guideline. No import site elsewhere needs to change: everything is still
 * reachable from './navigation'.
 */

import {
  ArrowUpDown,
  Calendar,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Layers,
  List,
  MessageSquare,
  Radio,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { ModuleKey } from '@/lib/modules/registry';

/** Queue counters shown on OPERACIÓN items. Keyed to useNavCounts. */
export type CountKey = 'pickup' | 'reception' | 'distribution' | 'dispatch' | 'orders';

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

/**
 * SEGUIMIENTO — read-first, transversal, "what is happening right now".
 * Ordered by zoom level: the whole operation, then one order, then one
 * customer. None of these is a station: no scanner, no shift queue.
 */
export const TRACKING_ITEMS: NavItem[] = [
  {
    href: '/app/operations-control',
    label: 'Torre de control',
    icon: Radio,
    module: ModuleKey.OPS_CONTROL,
    isVisible: isAdminOrManager,
  },
  {
    href: '/app/orders',
    label: 'Pedidos',
    icon: List,
    countKey: 'orders',
    // No `module`: the cross-stage order list is not an optional module —
    // same as Dashboard ejecutivo. Every admin/manager/CS user sees it
    // regardless of which spec-45 modules the operator has enabled.
    isVisible: (ctx) => isAdminOrManager(ctx) || hasPermission('customer_service')(ctx),
  },
  {
    href: '/app/conversations',
    label: 'Conversaciones',
    icon: MessageSquare,
    module: ModuleKey.CONVERSATIONS,
    // Same predicate as Pedidos: customer service's daily loop is the two of
    // them together, which is why spec-67 stopped splitting them across a
    // section divider.
    isVisible: (ctx) => isAdminOrManager(ctx) || hasPermission('customer_service')(ctx),
  },
];

/**
 * OPERACIÓN — the shift's four stations, in the order a package physically
 * moves through them. Every item here has a `module`, a permission, a
 * `countKey` and a scanner screen; nothing else in the nav does.
 */
export const OPERATION_ITEMS: NavItem[] = [
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
  { title: 'SEGUIMIENTO', crumb: 'Seguimiento', items: TRACKING_ITEMS },
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
  orders: 40,
};

/** Sections filtered to what this user may see. Empty sections are dropped. */
export function buildNavSections(ctx: NavContext): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isReachable(item, ctx)),
  })).filter((section) => section.items.length > 0);
}

/** True when this user can actually open the item right now. */
function isReachable(item: NavItem, ctx: NavContext): boolean {
  return (
    item.isVisible(ctx) &&
    (item.module === undefined || ctx.enabledModules.includes(item.module))
  );
}

/**
 * Landing precedence — deliberately NOT the display order.
 *
 * This list is, item for item, the order `buildNavSections` flattened to
 * BEFORE spec-67 split the nav into three sections: OPERATION_ITEMS then
 * MANAGEMENT_ITEMS. Freezing it here is what makes the regrouping provably
 * neutral for every role instead of neutral-by-lucky-coincidence.
 *
 * DO NOT "tidy" this to match the new sidebar order. Its only job is to
 * preserve today's precedence; re-sorting it to look like the sidebar would
 * silently move where people land, which is exactly the coupling spec-67
 * removed. Adding a nav item? Append it here too — an item missing from this
 * list is invisible to both passes below.
 */
const LANDING_SCAN_ORDER: NavItem[] = [
  TRACKING_ITEMS[0], // Torre de control
  TRACKING_ITEMS[1], // Pedidos
  ...OPERATION_ITEMS, // Recogida · Recepción · Distribución · Despacho
  MANAGEMENT_ITEMS[0], // Dashboard ejecutivo
  MANAGEMENT_ITEMS[1], // Capacidad
  TRACKING_ITEMS[2], // Conversaciones
  MANAGEMENT_ITEMS[2], // Auditoría
  MANAGEMENT_ITEMS[3], // Admin
];

/**
 * Where a signed-in user starts. Used by `/app` now that the marketing landing
 * page no longer occupies `/`.
 *
 * Prefer the first reachable item that has a `module` — a real queue the
 * operator is actually mid-rollout on — falling back to the first reachable
 * item when none qualifies. Both passes walk `LANDING_SCAN_ORDER`, never
 * `NAV_SECTIONS`.
 *
 * ── History, so the same ground is not re-litigated a fourth time ──
 *
 * Round 1 (spec-65 Task 3): preferred the plain first visible item, reasoning
 * that Pedidos sits second and is ungated so it makes a good universal start.
 *
 * Round 2 (spec-65 review): reversed it. An admin activated on only PICKUP
 * mid-rollout landing on the cross-stage Pedidos list instead of their pickup
 * queue is a regression — `src/app/app/page.test.tsx` ("respects module
 * activation over role") caught it. Hence the `module` preference.
 *
 * Round 3 (spec-67): the scan itself was the bug. It read `NAV_SECTIONS` in
 * order, so landing was a side effect of DISPLAY order — regrouping the
 * sidebar moved it. Moving Conversaciones (which carries a `module`) into the
 * first section jumped it ahead of all four stations, sending an ops manager
 * without OPS_CONTROL to Conversaciones instead of their station. The fix is
 * the explicit list above, not a new preference rule: the rule is unchanged,
 * only the sequence it walks is now pinned.
 *
 * A rejected round-3 candidate, recorded so it is not retried: "prefer the
 * first reachable OPERATION_ITEMS entry". It breaks the tower — Torre de
 * control lives in TRACKING_ITEMS now, so it would stop being a candidate and
 * every fully-enabled admin would land on /app/pickup.
 */
export function resolveLandingPath(ctx: NavContext): string {
  const reachable = LANDING_SCAN_ORDER.filter((item) => isReachable(item, ctx));
  const moduleGated = reachable.find((item) => item.module !== undefined);
  return (moduleGated ?? reachable[0])?.href ?? '/app/dashboard';
}

export * from './navigation.mobile';
export * from './navigation.breadcrumbs';
