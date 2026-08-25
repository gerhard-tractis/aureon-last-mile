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
