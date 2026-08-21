/**
 * spec-62 — pure presentation helpers for the mobile Recepción yard screen.
 *
 * `timeLabel` and `minutesSince` moved here from `app/app/reception/arrivals.ts`,
 * where they were private, because `minutesSince` is the single source of
 * `waitingMinutes` for the whole mobile yard screen — a second copy of that
 * arithmetic would desync from the original at the first correction.
 *
 * `lib/pickup/pickupMobileHelpers.ts` already has its own `timeLabel` and
 * `driverInitials`. This module does not import them: mobile components are
 * owned per-module (spec-62 decision 2), and a Recepción → Recogida import
 * would couple two modules over three lines of formatting.
 */

/** "M. Rojas" → "MR". First letter of the first and last word, uppercased.
 *  `null`/empty never fabricates initials; it renders a placeholder glyph. */
export function receptionInitials(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "41 min" under an hour, "1 h 35 min" over an hour, "1 h" on an exact
 *  hour (no "0 min" tail). `null` when there is no arrival time to measure
 *  a wait from. */
export function waitLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} h` : `${hours} h ${remaining} min`;
}

/** "07:31" from an ISO timestamp, or `null` for a missing/invalid date
 *  instead of the string "Invalid Date". */
export function timeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

/** Minutes elapsed between `iso` and `now`, clamped to 0 so a clock-skewed
 *  or future timestamp never reports a negative wait. `null` without an
 *  arrival time. */
export function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 60_000));
}

/** A truck waiting this long without being counted is the thing to act on.
 *  Lives here, beside `waitLabel`, which formats the same quantity — moved
 *  from `app/app/reception/arrivals.ts` to restore the `app→components→
 *  hooks→lib→Supabase` layering rule (components may not import `app/`).
 *  `arrivals.ts` re-exports it so existing importers keep working. */
export const YARD_WAIT_WARNING_MINUTES = 30;
