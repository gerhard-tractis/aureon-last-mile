/**
 * Returns the ISO date (`YYYY-MM-DD`) for `n` days before the current
 * moment.
 *
 * Code-review finding on spec-75: `DispatchCompletedRoutesTab` used to
 * compute this once at module load and reuse the frozen value for the life
 * of the tab. A dispatcher's PWA tab left open across midnight — the normal
 * shape of a shift, not an edge case — would silently keep querying "últimos
 * 7 días" anchored to whatever day the module first loaded. Call this from
 * inside the component (not at module scope) so every render resolves it
 * fresh.
 */
export function daysAgoISO(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().split('T')[0];
}
