// apps/frontend/src/lib/dispatch/mobile/crew-board.ts
//
// spec-76 phase 1-2 — pure row-shaping for the crew mobile home (2a) and
// route list (2b). Kept dependency-free (no Supabase types), mirroring
// lib/dispatch/loading-monitor-aggregate.ts's split between fetching
// (hooks/dispatch/mobile/useCrewLoadingBoard.ts) and shaping (here) so the
// logic is testable without mocking a client.
//
// Deliberately does NOT reuse loading-monitor-aggregate's `aggregateCrew`
// scan-rate figures for "today" — that module's `scanCount` spans whatever
// route-date window its caller passed in (the En carga monitor's 3-day
// lookback), a different axis from "packages I scanned today" this screen
// needs (spec-76 Lecciones aplicadas #9 / Añadido #6: two distinct signals
// must not collapse into one). `aggregatePackagesByRoute` IS reused as-is —
// route-level box totals have no date axis to conflate.

import { DISPATCHABLE_STATUSES } from '../scan-validator';
import type { RouteStatus } from '../types';

export interface CrewDispatchLinkRow {
  route_id: string | null;
  order_id: string | null;
}

export interface CrewPackageRow {
  order_id: string;
  loaded_at: string | null;
  loaded_by: string | null;
  status: string;
}

export interface CrewRouteRow {
  id: string;
  status: RouteStatus;
  loadPositionLabel: string | null;
  vehicleExternalId: string | null;
  driverName: string | null;
  createdAtIso: string;
}

export type RouteCardChip = 'tu_carga' | 'borrador' | 'lista' | 'otra_cuadrilla';

export interface RouteCard {
  id: string;
  code: string;
  status: RouteStatus;
  chip: RouteCardChip;
  comuna: string | null;
  otherComunaCount: number;
  packagesTotal: number;
  packagesLoaded: number;
  percent: number;
  loadPositionLabel: string | null;
  driverName: string | null;
  vehicleExternalId: string | null;
  /** Full name of whoever most recently scanned on this route while it is
   *  `loading` and that person is not `forUserId` — spec-76 decision 9. */
  loadedByOtherName: string | null;
}

/** Route id -> 8-char uppercase code, the same convention RouteBuilder's
 *  header already uses (`routeId.slice(0, 8).toUpperCase()`) — there is no
 *  human route-code column. */
export function routeCode(routeId: string): string {
  return routeId.slice(0, 8).toUpperCase();
}

/** order_id -> route_id, first dispatch wins (mirrors loading-monitor-
 *  aggregate.ts's routeIdByOrder). */
function routeIdByOrder(dispatches: readonly CrewDispatchLinkRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of dispatches) {
    if (d.order_id && d.route_id && !map.has(d.order_id)) map.set(d.order_id, d.route_id);
  }
  return map;
}

export interface RouteBoxAgg { total: number; loaded: number }

/** Per-route outstanding/loaded box counts — same counting rule as
 *  useRoutePackages.ts and loading-monitor-aggregate.ts's
 *  aggregatePackagesByRoute: a package counts if it is already loaded OR
 *  still in DISPATCHABLE_STATUSES; a dañado/retenido/entregado box that was
 *  never loaded counts toward neither. */
export function aggregateBoxesByRoute(
  dispatches: readonly CrewDispatchLinkRow[],
  packages: readonly CrewPackageRow[],
): Map<string, RouteBoxAgg> {
  const byOrder = routeIdByOrder(dispatches);
  const out = new Map<string, RouteBoxAgg>();
  for (const p of packages) {
    const routeId = byOrder.get(p.order_id);
    if (!routeId) continue;
    const dispatchable = (DISPATCHABLE_STATUSES as readonly string[]).includes(p.status);
    if (!p.loaded_at && !dispatchable) continue;
    const agg = out.get(routeId) ?? { total: 0, loaded: 0 };
    agg.total += 1;
    if (p.loaded_at) agg.loaded += 1;
    out.set(routeId, agg);
  }
  return out;
}

export interface ComunaSummary { comuna: string | null; otherCount: number }

/** Per-route comuna breakdown, reduced to "the dominant comuna, plus how
 *  many other comunas the route also touches" — 2a's card shows one comuna
 *  next to the andén, not a table. Ties resolve to the first comuna seen
 *  (stable given the routes/orders each ship in a fixed query order), which
 *  never asserts a false single-comuna fact: `otherCount > 0` is always
 *  shown alongside it by the caller. */
export function summarizeComunaByRoute(
  dispatches: readonly CrewDispatchLinkRow[],
  comunaByOrder: ReadonlyMap<string, string | null>,
): Map<string, ComunaSummary> {
  const byOrder = routeIdByOrder(dispatches);
  const countsByRoute = new Map<string, Map<string, number>>();
  for (const [orderId, routeId] of byOrder) {
    const comuna = comunaByOrder.get(orderId);
    if (!comuna) continue;
    const counts = countsByRoute.get(routeId) ?? new Map<string, number>();
    counts.set(comuna, (counts.get(comuna) ?? 0) + 1);
    countsByRoute.set(routeId, counts);
  }
  const out = new Map<string, ComunaSummary>();
  for (const [routeId, counts] of countsByRoute) {
    let top: string | null = null;
    let topCount = -1;
    for (const [comuna, count] of counts) {
      if (count > topCount) {
        top = comuna;
        topCount = count;
      }
    }
    out.set(routeId, { comuna: top, otherCount: Math.max(0, counts.size - 1) });
  }
  return out;
}

export interface RouteLoader { userId: string; fullName: string; lastScanAtIso: string }

/** Route id -> whoever scanned there most recently. One entry per user per
 *  their single most-recent route (spec-76 mirrors loading-monitor-
 *  aggregate.ts's `aggregateCrew`: a crew member can move between routes
 *  across a shift, only their latest scan says where they are now), then
 *  regrouped by route so a route can show its current loader. */
export function findLoaderByRoute(
  dispatches: readonly CrewDispatchLinkRow[],
  packages: readonly CrewPackageRow[],
  namesByUserId: ReadonlyMap<string, string>,
): Map<string, RouteLoader> {
  const byOrder = routeIdByOrder(dispatches);
  const latestByUser = new Map<string, { routeId: string; lastScanAtIso: string }>();
  for (const p of packages) {
    if (!p.loaded_at || !p.loaded_by) continue;
    const routeId = byOrder.get(p.order_id);
    if (!routeId) continue;
    const existing = latestByUser.get(p.loaded_by);
    if (!existing || Date.parse(p.loaded_at) > Date.parse(existing.lastScanAtIso)) {
      latestByUser.set(p.loaded_by, { routeId, lastScanAtIso: p.loaded_at });
    }
  }
  const out = new Map<string, RouteLoader>();
  for (const [userId, { routeId, lastScanAtIso }] of latestByUser) {
    const existing = out.get(routeId);
    if (!existing || Date.parse(lastScanAtIso) > Date.parse(existing.lastScanAtIso)) {
      out.set(routeId, { userId, fullName: namesByUserId.get(userId) ?? 'Otra persona', lastScanAtIso });
    }
  }
  return out;
}

/** The chip a route card shows — spec-76 decisions 6/9 and the Fase 2 test
 *  list (`TU CARGA` / `BORRADOR` / `LISTA` / another crew's route, shown
 *  but not openable). */
export function routeChip(
  status: RouteStatus,
  loader: RouteLoader | undefined,
  forUserId: string | null,
): RouteCardChip {
  if (status === 'loaded') return 'lista';
  if (status === 'loading' && loader) {
    return loader.userId === forUserId ? 'tu_carga' : 'otra_cuadrilla';
  }
  return 'borrador';
}

export function buildRouteCards(
  routes: readonly CrewRouteRow[],
  dispatches: readonly CrewDispatchLinkRow[],
  packages: readonly CrewPackageRow[],
  comunaByOrder: ReadonlyMap<string, string | null>,
  namesByUserId: ReadonlyMap<string, string>,
  forUserId: string | null,
): RouteCard[] {
  const boxes = aggregateBoxesByRoute(dispatches, packages);
  const comunas = summarizeComunaByRoute(dispatches, comunaByOrder);
  const loaders = findLoaderByRoute(dispatches, packages, namesByUserId);

  return routes.map((r): RouteCard => {
    const box = boxes.get(r.id) ?? { total: 0, loaded: 0 };
    const comuna = comunas.get(r.id) ?? { comuna: null, otherCount: 0 };
    const loader = loaders.get(r.id);
    const chip = routeChip(r.status, loader, forUserId);
    return {
      id: r.id,
      code: routeCode(r.id),
      status: r.status,
      chip,
      comuna: comuna.comuna,
      otherComunaCount: comuna.otherCount,
      packagesTotal: box.total,
      packagesLoaded: box.loaded,
      percent: box.total > 0 ? Math.round((box.loaded / box.total) * 100) : 0,
      loadPositionLabel: r.loadPositionLabel,
      driverName: r.driverName,
      vehicleExternalId: r.vehicleExternalId,
      loadedByOtherName: chip === 'otra_cuadrilla' ? (loader?.fullName ?? null) : null,
    };
  });
}

export interface ShiftScanStats {
  scannedToday: number;
  /** Packages per hour, from this user's first to last scan seen today.
   *  `null` until there are at least two scans to derive a rate from — a
   *  single scan has no elapsed interval, and showing "0/h" or a fabricated
   *  rate would both be dishonest (spec-76 lesson: no proxy under a label
   *  asserting a fact). */
  ratePerHour: number | null;
}

/** `todayISO` must come from `todayISOInTimezone()` at render/query time,
 *  never computed once at module load (spec-76 Lecciones #9). Compares the
 *  CIVIL date of each `loaded_at` instant in `TIMEZONE`, not a UTC slice. */
export function computeTodayScanStats(
  packages: readonly CrewPackageRow[],
  userId: string | null,
  todayISO: string,
  civilDateOf: (iso: string) => string,
): ShiftScanStats {
  if (!userId) return { scannedToday: 0, ratePerHour: null };
  const mine = packages.filter(
    (p) => p.loaded_by === userId && p.loaded_at && civilDateOf(p.loaded_at) === todayISO,
  );
  if (mine.length === 0) return { scannedToday: 0, ratePerHour: null };
  const times = mine.map((p) => Date.parse(p.loaded_at as string)).sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  const hoursElapsed = (last - first) / (1000 * 60 * 60);
  // Under 6 minutes of spread is too little to trust a per-hour projection
  // (one scan right after another would extrapolate to an absurd rate) —
  // render "still warming up" (null) instead of a number that looks precise
  // but isn't.
  const ratePerHour = hoursElapsed >= 0.1 ? mine.length / hoursElapsed : null;
  return { scannedToday: mine.length, ratePerHour };
}

export type RouteTab = 'todas' | 'mias' | 'listas';

export function filterRouteCards(cards: readonly RouteCard[], tab: RouteTab): RouteCard[] {
  if (tab === 'listas') return cards.filter((c) => c.status === 'loaded');
  if (tab === 'mias') return cards.filter((c) => c.chip === 'tu_carga');
  return [...cards];
}

export function routeTabCounts(cards: readonly RouteCard[]): Record<RouteTab, number> {
  return {
    todas: cards.length,
    mias: cards.filter((c) => c.chip === 'tu_carga').length,
    listas: cards.filter((c) => c.status === 'loaded').length,
  };
}
