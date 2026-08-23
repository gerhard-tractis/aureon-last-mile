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

export const OPERATION_ITEMS: NavItem[] = [
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
  orders: 40,
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
 * Where a signed-in user starts. Used by `/app` now that the marketing landing
 * page no longer occupies `/`.
 *
 * This is deliberately the first item the sidebar would show rather than a
 * hardcoded route: OPERACIÓN leads with the control tower, so admins and
 * operations managers land there, while a warehouse or driver account — for
 * whom the tower is hidden and would render empty — lands on the first queue
 * it can actually work. Dashboard ejecutivo is visible to everyone, so the
 * fallback is only reached if the nav is ever emptied entirely.
 *
 * spec-65: Pedidos carries no module gate (see OPERATION_ITEMS above) and
 * sits second, right after the tower — so once the tower is unavailable
 * (hidden for the role, or its module disabled for the operator) Pedidos is
 * the next visible item and becomes the landing target ahead of any
 * module-gated queue like Recogida. That's a deliberate choice, not an
 * accident of ordering: the cross-stage order list is the base entity view,
 * meaningful to any operator that has orders at all, and a customer_service
 * user — who can never see the tower — lands there directly rather than on
 * the executive dashboard fallback.
 */
export function resolveLandingPath(ctx: NavContext): string {
  const first = buildNavSections(ctx)[0]?.items[0];
  return first?.href ?? '/app/dashboard';
}

export * from './navigation.mobile';
export * from './navigation.breadcrumbs';
