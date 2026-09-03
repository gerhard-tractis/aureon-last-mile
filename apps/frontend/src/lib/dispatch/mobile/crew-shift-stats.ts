// apps/frontend/src/lib/dispatch/mobile/crew-shift-stats.ts
//
// spec-76 review M5 — split off crew-board.ts to keep it under 300 lines as
// tasks 2-6 add to it. 2a's ESCANEADOS HOY / RITMO tiles.
import type { CrewPackageRow } from './crew-board';

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
 *  never computed once at module load (spec-76 Lecciones aplicadas #9).
 *  `civilDateOf` compares each `loaded_at` instant's CIVIL date in
 *  `TIMEZONE` (lib/dispatch/mobile/civil-date.ts), not a UTC slice. */
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
