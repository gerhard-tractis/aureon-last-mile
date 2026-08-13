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
 * Breadcrumb for a pathname, from the same definition the sidebar uses, so the
 * two cannot disagree. Matches the longest href prefix, which is what keeps
 * `/admin/users` on Admin rather than on a shorter accidental match.
 */
export function breadcrumbForPath(pathname: string): { section: string; page: string } | null {
  let best: { section: string; page: string; length: number } | null = null;

  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(item.href + '/');
      if (!matches) continue;
      if (best && item.href.length <= best.length) continue;
      best = { section: section.crumb, page: item.label, length: item.href.length };
    }
  }

  return best ? { section: best.section, page: best.page } : null;
}
