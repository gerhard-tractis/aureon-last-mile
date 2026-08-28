/**
 * spec-54 phase 2 / spec-65 Task 3 — the mobile bottom tab bar.
 *
 * Split out of navigation.ts (which re-exports everything here) purely to
 * keep that file under the project's 300-line guideline — no logic changed
 * in the move.
 */

// CIRCULAR-IMPORT CONSTRAINT: navigation.ts does `export * from './navigation.mobile'`,
// so this file and navigation.ts import each other. Under ESM depth-first evaluation
// this file's body runs BEFORE navigation.ts's own top-level code finishes, so
// OPERATION_ITEMS may only be read inside function bodies (as buildMobileTabs does) —
// never at module scope here. Reading it at module scope would hit the TDZ and throw
// a ReferenceError at import time: a startup crash, not a test failure.
import type { NavContext, NavItem } from './navigation';
import { OPERATION_ITEMS } from './navigation';

/**
 * spec-54 — the mobile bottom tab bar.
 *
 * Floor and van roles only. `operations_manager` and `admin` do their work
 * on desktop; a phone in their hand is incidental, and a 4-tab driver bar
 * would hide most of the three-section nav they actually need — they keep
 * the hamburger `Sheet` instead (see AppLayout).
 *
 * spec-61 — `pickup_leader` belongs here for the same reason `pickup_crew`
 * does: it is a van role. A role missing from this set gets NO tab bar
 * (`buildMobileTabs` returns `[]` below), which on a phone means no
 * navigation at all. Exported so navigation.mobile.test.ts can assert the set
 * rather than restate it.
 *
 * spec-66 — `ops_leader` is the floor role that works all four stations. It
 * belongs here and NOT with the desk roles above: the tab bar is the whole
 * point of it. Being in this set is only half the story — the four tabs still
 * render `disabled` without the matching permissions, which is why the role's
 * defaults grant all four (migration 20260824000002).
 */
export const OPERATIONS_ROLES = [
  'pickup_crew',
  'pickup_leader',
  'ops_leader',
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
 * the tab bar can never drift from the sidebar's icons/labels.
 *
 * spec-67: this used to need a hand-maintained exclusion list, because
 * OPERATION_ITEMS also held `Torre de control` and `Pedidos` — neither of
 * which is a driver tab. Now that OPERACIÓN *is* exactly the four stations,
 * mapping the whole array says the same thing structurally, and the list is
 * gone. If a fifth tab ever appears here, the section gained a non-station
 * item and THAT is the bug to fix.
 *
 * Exactly four, always — never fewer, whatever the permission/module
 * state — marking `disabled` rather than omitting. The permission gate
 * (`isVisible`) and the spec-45 module gate (`enabledModules`) both fold
 * into that one flag: an ops user sees the whole shape of the app, greyed
 * out wherever it isn't theirs, for either reason.
 */
export function buildMobileTabs(ctx: NavContext): MobileTab[] {
  if (!isOperationsRole(ctx.role)) return [];
  return OPERATION_ITEMS.map((item) => ({
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
 *
 * spec-68 Fase 3 (Decisión 2) — `/app/distribution/pendientes` gets the
 * same treatment: it owns a fixed bottom action bar (Escanear + selección).
 * `/app/distribution` itself stays OUT — it's the screen the crew
 * navigates from, so it keeps the tab bar. `/quicksort` joins this list in
 * Fase 5, not here.
 *
 * spec-68 Fase 4 — `/app/distribution/consolidacion` joins for the same
 * reason: its footer carries Mover a andén / Liberar a sectorización.
 *
 * spec-68 Fase 5 — `/app/distribution/quicksort` joins too: both step 1
 * and step 2 own a fixed bottom action bar of their own (Ingresar código /
 * Cerrar lote, or Enviar a consolidación / Cancelar — see
 * `QuickSortMobile`/`QuickSortMobileDock`). The desktop tree at this same
 * route keeps its own header instead — this list only gates the GLOBAL
 * `MobileTabBar`, which never renders above `lg` anyway.
 *
 * spec-71 phase 5 review item 4 — `/app/distribution/mover-a-posicion`
 * joins for the same reason as every route above it: its own footer
 * (`app/app/distribution/mover-a-posicion/page.tsx`) is a `fixed bottom-0
 * z-40` action bar (Escanear), and without this entry `MobileTabBar`
 * would render underneath it at `fixed bottom-0 z-30` — same overlap bug
 * this list exists to prevent for pendientes/consolidacion/quicksort.
 */
const MOBILE_IMMERSIVE_PREFIXES = [
  '/app/pickup/scan',
  '/app/pickup/review',
  '/app/pickup/route/active',
  '/app/reception/route',
  '/app/distribution/pendientes',
  '/app/distribution/consolidacion',
  '/app/distribution/quicksort',
  '/app/distribution/mover-a-posicion',
];

export function isImmersiveMobileRoute(pathname: string): boolean {
  return MOBILE_IMMERSIVE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}
