export const AT_RISK_HOURS = 6;

interface OrderWindow {
  delivery_date: string;
  delivery_window_start: string;
  delivery_window_end: string;
  rescheduled_delivery_date: string | null;
  rescheduled_window_start: string | null;
  rescheduled_window_end: string | null;
  delivered_at: string | null;
}

export interface EffectiveWindow {
  startISO: string;
  endISO: string;
}

export interface RiskResult {
  status: 'late' | 'at_risk' | 'ok' | 'none';
  minutesRemaining: number;
  label: string;
}

function toISO(date: string, time: string): string {
  // PostgreSQL TIME columns serialize as "HH:MM:SS" via row_to_json.
  // Normalise to "HH:MM" so the appended ":00" produces a valid ISO string.
  const hhmm = time.slice(0, 5);
  return `${date}T${hhmm}:00`;
}

function fmtDuration(totalMinutes: number): string {
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${h}h ${m}m`;
}

export function effectiveWindow(order: OrderWindow): EffectiveWindow {
  const hasReschedule =
    order.rescheduled_delivery_date !== null &&
    order.rescheduled_window_start !== null &&
    order.rescheduled_window_end !== null;

  if (hasReschedule) {
    return {
      startISO: toISO(order.rescheduled_delivery_date!, order.rescheduled_window_start!),
      endISO: toISO(order.rescheduled_delivery_date!, order.rescheduled_window_end!),
    };
  }

  return {
    startISO: toISO(order.delivery_date, order.delivery_window_start),
    endISO: toISO(order.delivery_date, order.delivery_window_end),
  };
}

export function classifyRisk(order: OrderWindow, now: Date): RiskResult {
  // Use loose equality: treats both null and undefined as "not delivered".
  // The snapshot RPC filters out 'entregado' orders server-side, so
  // delivered_at may simply be absent from the payload.
  if (order.delivered_at != null) {
    return { status: 'none', minutesRemaining: 0, label: '—' };
  }

  const { endISO } = effectiveWindow(order);
  const endMs = new Date(endISO).getTime();
  const remainingMinutes = Math.floor((endMs - now.getTime()) / 60_000);

  if (remainingMinutes < 0) {
    return {
      status: 'late',
      minutesRemaining: remainingMinutes,
      label: `ATRASADO ${fmtDuration(remainingMinutes)}`,
    };
  }

  if (remainingMinutes <= AT_RISK_HOURS * 60) {
    return {
      status: 'at_risk',
      minutesRemaining: remainingMinutes,
      label: `${fmtDuration(remainingMinutes)} restantes`,
    };
  }

  return {
    status: 'ok',
    minutesRemaining: remainingMinutes,
    label: `${fmtDuration(remainingMinutes)} restantes`,
  };
}
