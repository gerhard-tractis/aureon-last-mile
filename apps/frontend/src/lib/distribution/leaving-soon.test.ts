// apps/frontend/src/lib/distribution/leaving-soon.test.ts
import { describe, it, expect } from 'vitest';
import { countLeavingSoon, isLeavingSoon } from './leaving-soon';

const TODAY = '2026-08-24';

describe('isLeavingSoon', () => {
  it('is true when delivery_date is today', () => {
    expect(isLeavingSoon('2026-08-24', TODAY)).toBe(true);
  });

  it('is true when delivery_date is tomorrow', () => {
    expect(isLeavingSoon('2026-08-25', TODAY)).toBe(true);
  });

  it('is false when delivery_date is the day after tomorrow', () => {
    expect(isLeavingSoon('2026-08-26', TODAY)).toBe(false);
  });

  // Review fix (finding 5) — a package overdue by a day is not "on
  // schedule for later", it is MORE urgent than "sale mañana". Excluding
  // 'overdue' made a consolidation zone holding only late packages read
  // "Salen ya: 0" — the opposite of the truth. `formatRelativeDeliveryDate`
  // already exists to tell today/tomorrow/overdue/neutral apart; this
  // reuses it rather than re-deriving the day offset.
  it('is true when delivery_date is one day overdue', () => {
    expect(isLeavingSoon('2026-08-23', TODAY)).toBe(true);
  });

  it('is true when delivery_date is many days overdue', () => {
    expect(isLeavingSoon('2026-07-01', TODAY)).toBe(true);
  });

  it('is false when delivery_date is null', () => {
    expect(isLeavingSoon(null, TODAY)).toBe(false);
  });

  it('is false when delivery_date is an empty string', () => {
    expect(isLeavingSoon('', TODAY)).toBe(false);
  });

  // Timezone boundary: the function only ever compares two plain
  // YYYY-MM-DD strings (via formatRelativeDeliveryDate's UTC-midnight
  // arithmetic) — it never reads the caller's local clock, so a package
  // due at the very edge of the calendar day is never miscounted by
  // whatever timezone the browser happens to run in. (The caller is
  // responsible for handing in a `todayISO` that is itself correct for
  // the operator's local calendar day — see DistributionMobileView's
  // `todayISOFrom`.)
  it('does not shift across a UTC midnight boundary', () => {
    expect(isLeavingSoon('2026-12-31', '2026-12-31')).toBe(true);
    expect(isLeavingSoon('2027-01-01', '2026-12-31')).toBe(true);
    expect(isLeavingSoon('2027-01-02', '2026-12-31')).toBe(false);
  });
});

describe('countLeavingSoon', () => {
  it('counts overdue, today and tomorrow — excludes only later and missing dates', () => {
    const packages = [
      { delivery_date: '2026-08-20' }, // overdue
      { delivery_date: '2026-08-24' }, // hoy
      { delivery_date: '2026-08-25' }, // mañana
      { delivery_date: '2026-08-30' }, // later
      { delivery_date: null }, // missing
    ];
    expect(countLeavingSoon(packages, TODAY)).toBe(3);
  });

  it('is 0 for an empty list', () => {
    expect(countLeavingSoon([], TODAY)).toBe(0);
  });

  it('is 0 when every package is missing a delivery date', () => {
    expect(countLeavingSoon([{ delivery_date: null }, { delivery_date: '' }], TODAY)).toBe(0);
  });
});
