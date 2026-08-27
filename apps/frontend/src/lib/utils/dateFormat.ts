/**
 * Centralized date formatting utilities.
 * All timestamps are displayed in America/Santiago timezone.
 */

export const TIMEZONE = 'America/Santiago';
export const LOCALE = 'es-CL';

/** Full datetime: "09/03/2026 21:27:09" */
export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TIMEZONE,
  });
}

/** Short datetime: "09/03/2026 21:27" */
export function formatDateTimeShort(date: string | Date): string {
  return new Date(date).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIMEZONE,
  });
}

/** Date only: "09/03/2026" */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TIMEZONE,
  });
}

/**
 * "Today" as YYYY-MM-DD in the nave's civil timezone (America/Santiago),
 * NOT `now.toISOString().split('T')[0]`'s UTC date.
 *
 * spec-68 — Chile sits at UTC-3/-4, so from roughly 20:00 local the UTC
 * calendar date has already rolled over to tomorrow. The UTC-split version
 * scores a package genuinely due TODAY as overdue while crediting a
 * package due the day after tomorrow as "mañana" — exactly during the
 * evening shift these date comparisons matter most for. `Intl.DateTimeFormat`
 * with an explicit `timeZone` reads the correct civil date regardless of
 * the machine's own local timezone; `'en-CA'` formats as `YYYY-MM-DD`
 * directly.
 */
export function todayISOInTimezone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Weekday + day + month for a pure `YYYY-MM-DD` civil date (e.g.
 * `routes.route_date`) — "jue, 27 ago".
 *
 * spec-70 QA finding: RouteBuilder's header used `new Date()` (today) instead
 * of the route's own date. The naive fix, `new Date(routeDateISO)`, is *also*
 * wrong here: that string has no time component so JS parses it as UTC
 * midnight, and formatting a UTC instant with the viewer's *local* zone (what
 * `toLocaleDateString` does without an explicit `timeZone`) can roll the
 * calendar date back a day in Chile (UTC-3/-4) — `2026-08-26` renders as
 * "25 ago" for a browser sitting west of UTC. There is no instant to convert:
 * `route_date` names a day, not a moment, so both the parse and the format
 * are pinned to UTC — never the ambient `TIMEZONE` — so the digits in the
 * column are the digits shown, regardless of where the browser sits.
 */
export function formatRouteHeaderDate(routeDateISO: string): string {
  return new Date(`${routeDateISO}T00:00:00Z`).toLocaleDateString(LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
