import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

/**
 * spec-54 3h redesign — pure helpers for the mobile "Recogidas de hoy"
 * screen. Kept out of the components so the "which load is next" and
 * "how do we label the driver" logic is unit-testable without rendering
 * anything (per `docs/architecture.md`'s hook/lib layering).
 */

/** "M. Rojas" → "MR". Mirrors the pattern already used for the floor-lead
 *  "Operarios activos" panel (`components/distribution/ActiveSortersPanel.tsx`)
 *  — first letter of the first and last word, uppercased. `null`/empty
 *  never fabricates a name; it renders a placeholder glyph instead. */
export function driverInitials(name: string | null | undefined): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "mié 13/08" — short weekday + day/month, the format the mock's subtitle
 *  uses. `todayLabel` in `pickupPageHelpers.ts` renders the long form used
 *  by the desktop header instead; this is a distinct, shorter format for
 *  the phone subtitle line, not a duplicate. */
export function shortDateLabel(now: Date): string {
  const weekday = new Intl.DateTimeFormat('es-CL', { weekday: 'short' }).format(now);
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  // es-CL renders weekdays as "mié." with a trailing period — strip it to
  // match the mock's plain "mié".
  return `${weekday.replace(/\.$/, '')} ${day}/${month}`;
}

/** "07:31" from an ISO timestamp, for the "cerrada HH:MM" compact-row line. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export type LoadFinishState = 'unfinished' | 'completed' | 'cancelled';

function finishState(status: RouteManifestRow['status']): LoadFinishState {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'unfinished';
}

export interface SplitLoads {
  /** First not-yet-finished load in queue order, or null when every load
   *  is completed/cancelled (or the route has none) — never a completed
   *  load promoted to "next". */
  next: RouteManifestRow | null;
  /** Unfinished loads other than `next`, in queue order. */
  remaining: RouteManifestRow[];
  /** Loads with status 'completed', in queue order. */
  completedLoads: RouteManifestRow[];
}

/**
 * Splits the route's manifests (already ordered oldest-attached-first by
 * `useRouteManifests`) into the "SIGUIENTE" hero card, the compact
 * "remaining" rows, and the compact "completed" rows.
 *
 * No stop-sequence column exists (`manifests` hangs off `pickup_routes` by
 * FK only) — "next" means "first load in queue order that is not yet
 * finished", so the badge reads as a status, never as a position number.
 * Cancelled loads are excluded from `next` (nothing to start) but still
 * listed in `remaining` so they are not silently dropped from the screen.
 */
export function splitLoads(manifests: RouteManifestRow[]): SplitLoads {
  let next: RouteManifestRow | null = null;
  const remaining: RouteManifestRow[] = [];
  const completedLoads: RouteManifestRow[] = [];

  for (const m of manifests) {
    const state = finishState(m.status);
    if (state === 'completed') {
      completedLoads.push(m);
      continue;
    }
    if (state === 'unfinished' && next === null) {
      next = m;
      continue;
    }
    remaining.push(m);
  }

  return { next, remaining, completedLoads };
}
