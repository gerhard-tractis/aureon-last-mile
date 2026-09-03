// apps/frontend/src/lib/dispatch/loading-monitor.ts
//
// spec-75 phase 3 — pure derivation helpers for the "En carga" monitor
// (artboard `1b`). No Supabase, no React: everything here is a function of
// data the caller already has, so it can be unit-tested without mocking a
// query client and reused by both the hook (useLoadingMonitor) and the
// components that render freshness text live (rule 9 — no dates computed
// once at module load; every consumer of these functions is expected to
// re-call them on a tick, not memoize the result of a stale `Date.now()`).

import type { RouteStatus } from './types';

/**
 * "DETENIDA" is not a stored status — spec-70's route_status_enum has no
 * such value, and this task is explicit that none is added. It is derived
 * from scan recency: a route that has started loading (at least one
 * package confirmed) but has gone quiet for this many minutes is stalled.
 *
 * 10 minutes, not 1 or 60: the design's own worked example shows a route
 * still counted "loading" 8 seconds after its last scan and a stalled one
 * at "sin escaneos 14 min" — so the true threshold sits somewhere in
 * between. A warehouse crew working a route scans every few seconds to a
 * couple of minutes per box in the steady state (spec-73/74's own package-
 * count precedents assume dozens to low hundreds of boxes per route); a
 * gap under ~5 minutes is very plausibly a break, a bathroom run, or a
 * jam at the scanner, not an abandoned route. 10 minutes is picked as the
 * point past which "the crew stepped away for a bit" stops being the more
 * likely explanation than "nobody is working this route any more" — long
 * enough not to flag every micro-pause as an incident, short enough that a
 * genuinely stalled route surfaces well within a shift rather than at the
 * end of it. There is no measured data backing a sharper number; this is a
 * judgment call, named as a constant so it is one place to tune, not a
 * magic number buried in a component.
 */
export const STALL_THRESHOLD_MINUTES = 10;

/**
 * The four route states artboard `1b` renders. Distinct from `RouteStatus`
 * (the stored DB enum): `draft` and `ready` map 1:1 to the stored
 * `draft`/`loaded` statuses, but `loading` and `stalled` are both derived
 * from the stored `planned`/`loading` statuses plus live scan recency —
 * `stalled` never exists as a column value, only as a computation.
 */
export type LoadState = 'stalled' | 'loading' | 'ready' | 'draft';

/**
 * Card sort order — "ordered so the ones going wrong are visible first"
 * (task brief). Stalled routes are actively bleeding time and need eyes
 * first; loading routes are healthy but still worth watching; ready routes
 * are a waiting action (dispatch) rather than an incident; draft routes
 * have not started and are the least time-sensitive of the four.
 */
export const LOAD_STATE_ORDER: Record<LoadState, number> = {
  stalled: 0,
  loading: 1,
  ready: 2,
  draft: 3,
};

/**
 * Maps a route's real `status` plus its live scan facts to the design's
 * four states. `status` alone decides `draft` and `ready`; for the two
 * remaining stored statuses (`planned`, `loading` — see LOADABLE_ROUTE_
 * STATUSES in types.ts) the decision is scan recency, per this task's
 * critical rule 1.
 *
 * A route that has never had a package scanned (`loadedBoxCount === 0`)
 * is never `stalled`, even if it has sat untouched for longer than the
 * threshold — "the crew stopped scanning" is a claim about something that
 * was happening and stopped; a route nobody has touched yet has not
 * stopped, it simply has not started. That is still `loading` (the tab's
 * open/default bucket), not a fifth state and not `draft` (this route DOES
 * have a plan, unlike a true `draft` with no orders assigned).
 */
export function deriveRouteLoadState(
  status: RouteStatus,
  loadedBoxCount: number,
  lastScanAtIso: string | null,
  nowMs: number,
): LoadState {
  if (status === 'draft') return 'draft';
  if (status === 'loaded') return 'ready';

  // status is 'planned' or 'loading' (or, defensively, anything else in
  // OPEN_ROUTE_STATUSES the caller passed through) — never started is
  // 'loading', started-then-quiet-too-long is 'stalled'.
  if (loadedBoxCount <= 0 || !lastScanAtIso) return 'loading';

  const minutesSinceLastScan = (nowMs - new Date(lastScanAtIso).getTime()) / 60_000;
  return minutesSinceLastScan >= STALL_THRESHOLD_MINUTES ? 'stalled' : 'loading';
}

/** "8 s" while under a minute since the scan, "N min" (rounded down, never
 *  negative) once it reaches 60s — the EN CARGA card's "último escaneo". */
export function formatFreshness(lastScanAtIso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - new Date(lastScanAtIso).getTime());
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)} s`;
  return `${Math.floor(deltaMs / 60_000)} min`;
}

/** "14 min" — the DETENIDA card's "sin escaneos N min". Always whole
 *  minutes; a route only reaches this formatter once it has already
 *  cleared STALL_THRESHOLD_MINUTES, so sub-minute output never occurs in
 *  practice, but the floor keeps the function honest on its own terms. */
export function formatStaleness(lastScanAtIso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - new Date(lastScanAtIso).getTime());
  return `${Math.floor(deltaMs / 60_000)} min`;
}

/**
 * Packages-per-hour, from the route's own first and most recent scan —
 * never a formula pulled from nowhere. Returns null (render nothing) when
 * there isn't yet enough elapsed time to make a rate meaningful: two boxes
 * scanned 3 seconds apart would otherwise report an absurd instantaneous
 * "2400/h". Two minutes is a low bar chosen only to rule out that
 * divide-by-near-zero case, not a claim about real steady-state pace.
 */
const MIN_ELAPSED_MINUTES_FOR_RATE = 2;

export function computeLoadRateFmt(
  loadedBoxCount: number,
  firstScanAtIso: string | null,
  nowMs: number,
): number | null {
  if (!firstScanAtIso || loadedBoxCount <= 0) return null;
  const elapsedMinutes = (nowMs - new Date(firstScanAtIso).getTime()) / 60_000;
  if (elapsedMinutes < MIN_ELAPSED_MINUTES_FOR_RATE) return null;
  return Math.round((loadedBoxCount / elapsedMinutes) * 60);
}

/** Stable sort by LOAD_STATE_ORDER — used to put stalled routes first
 *  without mutating the caller's array. */
export function sortByUrgency<T>(rows: readonly T[], stateOf: (row: T) => LoadState): T[] {
  return [...rows].sort((a, b) => LOAD_STATE_ORDER[stateOf(a)] - LOAD_STATE_ORDER[stateOf(b)]);
}
