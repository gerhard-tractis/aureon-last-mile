/**
 * spec-65 Task 7 — shared duration formatting for `OrderPackageList`'s
 * held-duration line and `WhyLateBlock`'s time-in-stage line, so the two
 * blocks that both need "how long has this been going on" agree on format.
 */
export function formatDurationSince(sinceISO: string, now: Date): string {
  const sinceMs = new Date(sinceISO).getTime();
  const totalMinutes = Math.max(0, Math.floor((now.getTime() - sinceMs) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
