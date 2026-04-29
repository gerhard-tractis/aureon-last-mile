export type DeliveryDateTone = 'overdue' | 'urgent' | 'soon' | 'neutral';

export interface RelativeDeliveryDate {
  label: string;
  tone: DeliveryDateTone;
}

const MONTHS_ES_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

function diffInDays(deliveryISO: string, todayISO: string): number {
  const a = new Date(deliveryISO + 'T00:00:00Z');
  const b = new Date(todayISO + 'T00:00:00Z');
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Formats a delivery date relative to today for the Distribución pending list.
 * - 0 days  → "hoy" (urgent)
 * - 1 day   → "mañana" (soon)
 * - -1 day  → "ayer" (overdue)
 * - other   → "DD mmm" in Spanish (overdue if past, neutral if future)
 */
export function formatRelativeDeliveryDate(
  deliveryISO: string,
  todayISO: string
): RelativeDeliveryDate {
  const days = diffInDays(deliveryISO, todayISO);
  if (days === 0) return { label: 'hoy', tone: 'urgent' };
  if (days === 1) return { label: 'mañana', tone: 'soon' };
  if (days === -1) return { label: 'ayer', tone: 'overdue' };

  const date = new Date(deliveryISO + 'T00:00:00Z');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mmm = MONTHS_ES_SHORT[date.getUTCMonth()];
  const label = `${dd} ${mmm}`;
  const tone: DeliveryDateTone = days < 0 ? 'overdue' : 'neutral';
  return { label, tone };
}
