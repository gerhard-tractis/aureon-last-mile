/**
 * spec-65 Task 1 — the shared SLA case table.
 *
 * This is the single specification that both implementations of the SLA rule
 * must satisfy:
 *   - TypeScript: `classifyRisk` in
 *     `apps/frontend/src/app/app/operations-control/lib/sla.ts`
 *     (verified against these cases by `sla-cases.test.ts`)
 *   - SQL: `public.order_sla_status(...)`
 *     (verified against these same cases, by name, in
 *     `packages/database/supabase/tests/order_sla_status.test.sql`)
 *
 * Adding a case means adding it here AND to the `.test.sql` file. The two
 * case tables are not generated from one another — that duplication is
 * exactly the guard against drift this task exists to build.
 *
 * `AT_RISK_HOURS` and `NOW_ISO` are re-declared here (not imported from
 * `sla.ts`) so `sla-cases.test.ts` can assert they still agree with the
 * authority. If they diverge, every expected verdict in this table measures
 * the wrong boundary.
 */

/** Must equal `AT_RISK_HOURS` exported from operations-control/lib/sla.ts. */
export const AT_RISK_HOURS = 6;

/**
 * The fixed instant every case is evaluated at. A wall-clock string with no
 * offset — `classifyRisk` does `new Date(isoString)` on window and reschedule
 * columns built the same way, so parsing this the same way keeps both sides
 * consistent regardless of the runner's local timezone.
 */
export const NOW_ISO = '2026-08-22T12:00:00';

export type SlaStatus = 'late' | 'at_risk' | 'ok' | 'none';

/**
 * Mirrors the order-window shape `classifyRisk` and `order_sla_status` both
 * consume. Nullable here (unlike `classifyRisk`'s own `OrderWindow` type)
 * because several cases exist precisely to exercise the null paths.
 */
export interface SlaCaseOrder {
  delivery_date: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  rescheduled_delivery_date: string | null;
  rescheduled_window_start: string | null;
  rescheduled_window_end: string | null;
  delivered_at: string | null;
}

export interface SlaCase {
  name: string;
  order: SlaCaseOrder;
  expectedStatus: SlaStatus;
  expectedMinutesRemaining: number;
  /**
   * Overrides NOW_ISO for this one case. Only needed to exercise a bug
   * class that a shared, seconds-free "now" can never see: seconds in a
   * window-end column truncated on the TypeScript side (sla.ts:
   * `time.slice(0, 5)`) but not on a naively-written SQL side. Reproducing
   * that divergence requires "now" itself to carry seconds too — see the
   * `seconds_in_window_end_are_truncated` case below.
   */
  nowISO?: string;
}

export const SLA_CASES: SlaCase[] = [
  {
    name: 'no_window',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: null,
      delivery_window_end: null,
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'none',
    expectedMinutesRemaining: 0,
  },
  {
    name: 'already_delivered',
    order: {
      delivery_date: '2020-01-01',
      delivery_window_start: '08:00:00',
      delivery_window_end: '09:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: '2020-01-01T09:30:00',
    },
    expectedStatus: 'none',
    expectedMinutesRemaining: 0,
  },
  {
    name: 'late_by_one_minute',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '11:00:00',
      delivery_window_end: '11:59:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'late',
    expectedMinutesRemaining: -1,
  },
  {
    name: 'late_by_large_margin',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '00:00:00',
      delivery_window_end: '00:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'late',
    expectedMinutesRemaining: -720,
  },
  {
    name: 'late_from_previous_day',
    order: {
      delivery_date: '2026-08-21',
      delivery_window_start: '19:00:00',
      delivery_window_end: '20:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'late',
    expectedMinutesRemaining: -960,
  },
  {
    // The most important case: classifyRisk uses `<=`, so exactly
    // AT_RISK_HOURS * 60 minutes remaining is still `at_risk`.
    name: 'at_risk_boundary_exactly',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '17:00:00',
      delivery_window_end: '18:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'at_risk',
    expectedMinutesRemaining: 360,
  },
  {
    // One minute past the boundary flips to `ok`. A SQL function written
    // with `<` instead of `<=` fails only this case.
    name: 'one_minute_past_boundary',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '17:01:00',
      delivery_window_end: '18:01:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'ok',
    expectedMinutesRemaining: 361,
  },
  {
    name: 'comfortably_at_risk',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '13:30:00',
      delivery_window_end: '14:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'at_risk',
    expectedMinutesRemaining: 120,
  },
  {
    name: 'comfortably_ok_tomorrow',
    order: {
      delivery_date: '2026-08-23',
      delivery_window_start: '11:00:00',
      delivery_window_end: '12:00:00',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'ok',
    expectedMinutesRemaining: 1440,
  },
  {
    // Original window is badly late; a complete reschedule overrides it.
    name: 'complete_reschedule_overrides_original',
    order: {
      delivery_date: '2026-08-20',
      delivery_window_start: '07:00:00',
      delivery_window_end: '08:00:00',
      rescheduled_delivery_date: '2026-08-22',
      rescheduled_window_start: '13:00:00',
      rescheduled_window_end: '14:00:00',
      delivered_at: null,
    },
    expectedStatus: 'at_risk',
    expectedMinutesRemaining: 120,
  },
  {
    // Only rescheduled_delivery_date is set; the other two reschedule
    // columns are null, so the reschedule must be ignored entirely and the
    // original window used instead.
    name: 'partial_reschedule_ignored',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '13:30:00',
      delivery_window_end: '14:00:00',
      rescheduled_delivery_date: '2026-08-25',
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    expectedStatus: 'at_risk',
    expectedMinutesRemaining: 120,
  },
  {
    // All three reschedule columns are set, but the new window is itself
    // already in the past.
    name: 'reschedule_itself_late',
    order: {
      delivery_date: '2026-08-23',
      delivery_window_start: '11:00:00',
      delivery_window_end: '12:00:00',
      rescheduled_delivery_date: '2026-08-21',
      rescheduled_window_start: '08:00:00',
      rescheduled_window_end: '09:00:00',
      delivered_at: null,
    },
    expectedStatus: 'late',
    expectedMinutesRemaining: -1620,
  },
  {
    // Seconds in the window-end column must be truncated before comparing,
    // exactly as `toISO` in sla.ts drops them via `time.slice(0, 5)`. A
    // naive SQL implementation that compares the full TIME value (seconds
    // included) computes a larger raw difference here — enough to cross the
    // at_risk/ok boundary that `at_risk_boundary_exactly` sits on. Needs its
    // own `nowISO` (also carrying seconds) to actually expose the bug: with
    // a whole-minute "now", the sub-minute remainder never changes which
    // minute the result floors to.
    name: 'seconds_in_window_end_are_truncated',
    order: {
      delivery_date: '2026-08-22',
      delivery_window_start: '17:01:58',
      delivery_window_end: '18:01:58',
      rescheduled_delivery_date: null,
      rescheduled_window_start: null,
      rescheduled_window_end: null,
      delivered_at: null,
    },
    nowISO: '2026-08-22T12:00:02',
    expectedStatus: 'at_risk',
    expectedMinutesRemaining: 360,
  },
];
