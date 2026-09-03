/**
 * The Pre-ruta delivery-window filter (`?window_start=` / `?window_end=`),
 * shared between PreRouteBoard (the board itself) and the dispatch page
 * header's "SIN RUTEAR" figure.
 *
 * spec-75 task 2b removed the four fixed time bands (Todas/Mañana/Tarde/
 * Noche) PreRouteFilters used to offer. `orders.delivery_window_start/end`
 * are arbitrary per-order times, not slots — grouping by a fixed band hid
 * orders rather than narrowing them. The two params here map 1:1 onto
 * get_pre_route_snapshot's `p_window_start` / `p_window_end`, so this
 * function no longer needs a lookup table, just pass-through with defaults
 * for a one-sided range.
 *
 * Code-review finding on spec-70's QA-findings PR (#556): the header used to
 * call `usePreRouteSnapshot` with only the `?date=` param applied, leaving
 * the window bounds at their `null` defaults, while PreRouteBoard applied
 * the window filter too. A single shared resolver (not two copies that can
 * drift) is what keeps that from happening again — every caller must
 * resolve the same `URLSearchParams` through this function rather than
 * reading `window_start`/`window_end` (or the old `window` band key)
 * itself, which is exactly how the date axis and the window axis ended up
 * split in the first place.
 */
export interface PreRouteWindowBounds {
  start: string;
  end: string;
}

/** Resolves `?window_start=`/`?window_end=` to snapshot bounds, or null when neither is set. */
export function resolvePreRouteWindow(params: URLSearchParams): PreRouteWindowBounds | null {
  const start = params.get('window_start');
  const end = params.get('window_end');
  if (!start && !end) return null;
  return { start: start ?? '00:00', end: end ?? '23:59' };
}
