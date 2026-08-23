import { describe, it, expect } from 'vitest';
import {
  isEmptyFilters,
  getPageFromParams,
  paginationLabel,
  buildQueryString,
  STATUS_OPTIONS,
} from './_page-helpers';
import { EMPTY_ORDERS_LIST_FILTERS, type OrdersListFilters } from '@/hooks/useOrdersList';

describe('isEmptyFilters', () => {
  it('is true for all-null filters', () => {
    expect(isEmptyFilters(EMPTY_ORDERS_LIST_FILTERS)).toBe(true);
  });

  it('is false when any single field is set, including falsy-but-meaningful ones', () => {
    expect(isEmptyFilters({ ...EMPTY_ORDERS_LIST_FILTERS, hasPod: false })).toBe(false);
    expect(isEmptyFilters({ ...EMPTY_ORDERS_LIST_FILTERS, minAttempts: 0 })).toBe(false);
  });
});

describe('getPageFromParams', () => {
  it('defaults to 0 with no pagina param', () => {
    expect(getPageFromParams(new URLSearchParams(''))).toBe(0);
  });

  it('parses a valid positive integer', () => {
    expect(getPageFromParams(new URLSearchParams('pagina=3'))).toBe(3);
  });

  it('falls back to 0 for garbage, negative, or fractional values — never throws', () => {
    expect(getPageFromParams(new URLSearchParams('pagina=abc'))).toBe(0);
    expect(getPageFromParams(new URLSearchParams('pagina=-5'))).toBe(0);
    expect(getPageFromParams(new URLSearchParams('pagina=2.5'))).toBe(0);
  });
});

describe('paginationLabel', () => {
  it('reads "0 de 0" when there are no results', () => {
    expect(paginationLabel(0, 0, 0)).toBe('0 de 0');
  });

  it('reads "1–12 de 47" shape for a partial first page', () => {
    expect(paginationLabel(0, 12, 47)).toBe('1–12 de 47');
  });

  it('offsets correctly for a later page', () => {
    expect(paginationLabel(1, 10, 60)).toBe('51–60 de 60');
  });
});

describe('buildQueryString', () => {
  it('omits pagina when page is 0', () => {
    const filters: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS };
    expect(buildQueryString('todas', filters, 0)).toBe('vista=todas');
  });

  it('appends pagina only when page > 0, after the filter params', () => {
    const filters: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS, statuses: ['en_ruta'] };
    expect(buildQueryString('en-reparto', filters, 2)).toBe('vista=en-reparto&estado=en_ruta&pagina=2');
  });
});

describe('STATUS_OPTIONS', () => {
  it('carries all eleven order_status_enum values, each with a Spanish label and no count', () => {
    expect(STATUS_OPTIONS).toHaveLength(11);
    for (const opt of STATUS_OPTIONS) {
      expect(opt.count).toBeUndefined();
      expect(opt.label.length).toBeGreaterThan(0);
    }
    expect(STATUS_OPTIONS.find((o) => o.status === 'en_ruta')?.label).toBe('En reparto');
  });
});
