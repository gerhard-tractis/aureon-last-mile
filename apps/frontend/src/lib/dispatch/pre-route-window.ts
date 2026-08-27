/**
 * The Pre-ruta delivery-window filter (`?window=`), shared between
 * PreRouteBoard (the board itself) and the dispatch page header's "SIN
 * RUTEAR" figure.
 *
 * Code-review finding on spec-70's QA-findings PR (#556): the header used to
 * call `usePreRouteSnapshot` with only the `?date=` param applied, leaving
 * the window bounds at their `null` defaults, while PreRouteBoard applied
 * `?window=` too. Selecting "Mañana" left the board's own totals line
 * correctly narrowed while the header kept counting every window — the same
 * class of disagreement this PR exists to kill, one filter over. A single
 * shared map (not two copies that can drift) is what keeps that from
 * happening again; each caller resolving its own copy is exactly how the
 * date axis and the window axis ended up split in the first place.
 */
export type PreRouteWindowKey = 'todas' | 'manana' | 'tarde' | 'noche';

export interface PreRouteWindowBounds {
  start: string;
  end: string;
}

export const WINDOW_TIME_MAP: Record<string, PreRouteWindowBounds | null> = {
  todas: null,
  manana: { start: '00:00', end: '12:00' },
  tarde: { start: '12:00', end: '17:00' },
  noche: { start: '17:00', end: '24:00' },
};

/** Resolves a `?window=` value (or an unknown one) to snapshot bounds. */
export function resolvePreRouteWindow(windowKey: string): PreRouteWindowBounds | null {
  return WINDOW_TIME_MAP[windowKey] ?? null;
}
