/**
 * spec-65 — shared cell formatters for `OrdersListRow`.
 *
 * Moved out of `OrdersDataTable` (final review round) so `orders-csv.ts` can
 * format the SLA and "último evento" columns the exact same way the table
 * does, instead of writing the raw `sla_status`/`leading_status` enum values
 * into a file operators forward to clients. One formatter, two consumers.
 */

import type { OrdersListRow } from '@/hooks/useOrdersList';

/**
 * Formats from the already-computed verdict — signed, hours omitted under
 * 60 minutes. Minutes are zero-padded only when an hour segment is present
 * ("1h 05m", not "1h 5m") — with no hour segment, "9m" is correct as-is.
 */
export function formatSlaCell(slaStatus: string, minutesRemaining: number | null): string {
  if (slaStatus === 'none' || minutesRemaining === null) return '—';
  const sign = minutesRemaining < 0 ? '−' : '+';
  const abs = Math.abs(minutesRemaining);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${sign}${h}h ${String(m).padStart(2, '0')}m` : `${sign}${m}m`;
}

export function formatLastEvent(row: Pick<OrdersListRow, 'last_event_at' | 'last_event_label'>): string {
  if (!row.last_event_at) return row.last_event_label ?? '—';
  const time = new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Santiago',
  }).format(new Date(row.last_event_at));
  return row.last_event_label ? `${time} ${row.last_event_label}` : time;
}
