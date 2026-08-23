/**
 * spec-54 phase 2 / spec-65 Task 3 — the mobile bottom tab bar.
 *
 * Split out of navigation.ts (which re-exports everything here) purely to
 * keep that file under the project's 300-line guideline — no logic changed
 * in the move.
 */

import type { NavContext, NavItem } from './navigation';
import { OPERATION_ITEMS } from './navigation';

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
 * `/app/orders` (Pedidos, spec-65) is excluded for the same reason: it's a
 * desktop screen for operations managers/admins/CS, and `isOperationsRole`
 * never overlaps with `isAdminOrManager` — a van or floor role could never
 * see it live anyway, so it would only ever render as a fifth, permanently
 * disabled tab.
 *
 * Exactly four, always — never fewer, whatever the permission/module
 * state — marking `disabled` rather than omitting. The permission gate
 * (`isVisible`) and the spec-45 module gate (`enabledModules`) both fold
 * into that one flag: an ops user sees the whole shape of the app, greyed
 * out wherever it isn't theirs, for either reason.
 */
const MOBILE_TAB_EXCLUDED_HREFS: ReadonlySet<string> = new Set([
  '/app/operations-control',
  '/app/orders',
]);

export function buildMobileTabs(ctx: NavContext): MobileTab[] {
  if (!isOperationsRole(ctx.role)) return [];
  return OPERATION_ITEMS.filter((item) => !MOBILE_TAB_EXCLUDED_HREFS.has(item.href)).map((item) => ({
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
 *
 * `/app/reception/route` covers the reception session and its completion
 * record, both of which own the same fixed footer — but not
 * `/app/reception` itself, which is the module-switching listing and needs
 * the tab bar to get anywhere else.
 */
const MOBILE_IMMERSIVE_PREFIXES = [
  '/app/pickup/scan',
  '/app/pickup/review',
  '/app/pickup/route/active',
  '/app/reception/route',
];

export function isImmersiveMobileRoute(pathname: string): boolean {
  return MOBILE_IMMERSIVE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}
