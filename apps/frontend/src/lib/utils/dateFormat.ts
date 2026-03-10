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
