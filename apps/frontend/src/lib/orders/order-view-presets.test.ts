import { describe, expect, it } from 'vitest';
import { EMPTY_ORDERS_LIST_FILTERS, type OrdersListFilters } from '@/hooks/useOrdersList';
import {
  ORDER_VIEW_PRESETS,
  DEFAULT_ORDER_VIEW_PRESET_ID,
  getPresetById,
  resolvePreset,
  filtersToSearchParams,
  searchParamsToState,
  type OrderViewPresetId,
} from './order-view-presets';

describe('ORDER_VIEW_PRESETS', () => {
  it('defines exactly the seven required presets, in order', () => {
    expect(ORDER_VIEW_PRESETS.map((p) => p.id)).toEqual([
      'sla-en-riesgo',
      'todas',
      'en-reparto',
      'excepciones',
      'pendientes-pod',
      'reingresos',
      'entregadas-hoy',
    ]);
  });

  it('makes sla-en-riesgo the default preset', () => {
    expect(DEFAULT_ORDER_VIEW_PRESET_ID).toBe('sla-en-riesgo');
  });

  it('sla-en-riesgo filters exactly match what get_nav_counts.orders counts', () => {
    const preset = getPresetById('sla-en-riesgo');
    expect(preset.filters).toEqual({ sla: ['late', 'at_risk'] });
  });

  it('todas carries no filters', () => {
    const preset = getPresetById('todas');
    expect(preset.filters).toEqual({});
  });

  it('en-reparto filters on en_ruta', () => {
    expect(getPresetById('en-reparto').filters).toEqual({ statuses: ['en_ruta'] });
  });

  it('excepciones filters on cancelado and parcialmente_entregado', () => {
    expect(getPresetById('excepciones').filters).toEqual({
      statuses: ['cancelado', 'parcialmente_entregado'],
    });
  });

  it('pendientes-pod filters delivered orders without a POD', () => {
    expect(getPresetById('pendientes-pod').filters).toEqual({
      statuses: ['entregado'],
      hasPod: false,
    });
  });

  it('reingresos filters on en_retorno', () => {
    expect(getPresetById('reingresos').filters).toEqual({ statuses: ['en_retorno'] });
  });

  it('entregadas-hoy has no baked-in date and requires an injected "today"', () => {
    const preset = getPresetById('entregadas-hoy');
    expect(preset.filters).toEqual({ statuses: ['entregado'] });
    expect(preset.isDateDependent).toBe(true);
  });

  it('labels are the exact Spanish tab labels from the brief', () => {
    const labels = Object.fromEntries(ORDER_VIEW_PRESETS.map((p) => [p.id, p.label]));
    expect(labels).toEqual({
      'sla-en-riesgo': 'SLA en riesgo',
      todas: 'Todas',
      'en-reparto': 'En reparto',
      excepciones: 'Excepciones',
      'pendientes-pod': 'Pendientes de POD',
      reingresos: 'Reingresos',
      'entregadas-hoy': 'Entregadas hoy',
    });
  });
});

describe('resolvePreset', () => {
  it('resolves the static presets to their constant filters', () => {
    expect(resolvePreset('en-reparto', '2026-08-22')).toEqual({ statuses: ['en_ruta'] });
  });

  it('resolves entregadas-hoy using the injected date, not the system clock', () => {
    expect(resolvePreset('entregadas-hoy', '2026-08-22')).toEqual({
      statuses: ['entregado'],
      dateFrom: '2026-08-22',
      dateTo: '2026-08-22',
    });
    expect(resolvePreset('entregadas-hoy', '2099-01-01')).toEqual({
      statuses: ['entregado'],
      dateFrom: '2099-01-01',
      dateTo: '2099-01-01',
    });
  });

  it('falls back to todas for an unknown preset id', () => {
    expect(resolvePreset('nonsense' as OrderViewPresetId, '2026-08-22')).toEqual({});
  });
});

describe('filtersToSearchParams', () => {
  it('produces a short URL for the default preset with no extra filters', () => {
    const params = filtersToSearchParams(DEFAULT_ORDER_VIEW_PRESET_ID, EMPTY_ORDERS_LIST_FILTERS);
    expect(params.toString()).toBe('');
  });

  it('includes a non-default preset id explicitly', () => {
    const params = filtersToSearchParams('en-reparto', EMPTY_ORDERS_LIST_FILTERS);
    expect(params.toString()).toBe('vista=en-reparto');
  });

  it('serializes array filters as comma-separated values under exact keys', () => {
    const filters: OrdersListFilters = {
      ...EMPTY_ORDERS_LIST_FILTERS,
      statuses: ['cancelado', 'parcialmente_entregado'],
      sla: ['late', 'at_risk'],
      comunas: ['Ñuñoa', 'Peñalolén'],
      routeIds: ['r1', 'r2'],
    };
    const params = filtersToSearchParams('todas', filters);
    expect(params.get('estado')).toBe('cancelado,parcialmente_entregado');
    expect(params.get('sla')).toBe('late,at_risk');
    expect(params.get('comuna')).toBe('Ñuñoa,Peñalolén');
    expect(params.get('ruta')).toBe('r1,r2');
    // no repeated keys
    expect(params.getAll('estado')).toHaveLength(1);
  });

  it('serializes scalar filters under exact keys and omits null/default values', () => {
    const filters: OrdersListFilters = {
      ...EMPTY_ORDERS_LIST_FILTERS,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-22',
      driver: 'Juan Pérez',
      client: 'Acme',
      hasPod: false,
      minAttempts: 2,
      search: 'ORD-123',
    };
    const params = filtersToSearchParams('todas', filters);
    expect(params.get('desde')).toBe('2026-08-01');
    expect(params.get('hasta')).toBe('2026-08-22');
    expect(params.get('conductor')).toBe('Juan Pérez');
    expect(params.get('cliente')).toBe('Acme');
    expect(params.get('pod')).toBe('false');
    expect(params.get('intentos')).toBe('2');
    expect(params.get('q')).toBe('ORD-123');
    // Nothing null should appear at all.
    expect(params.has('estado')).toBe(false);
    expect(params.has('sla')).toBe(false);
    expect(params.has('ruta')).toBe(false);
    expect(params.has('comuna')).toBe(false);
  });

  it('omits vista when the preset is the default one, even with extra filters', () => {
    const filters: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS, search: 'x' };
    const params = filtersToSearchParams(DEFAULT_ORDER_VIEW_PRESET_ID, filters);
    expect(params.toString()).toBe('q=x');
  });
});

describe('searchParamsToState', () => {
  it('defaults to the default preset and empty filters for an empty URL', () => {
    const result = searchParamsToState(new URLSearchParams(''));
    expect(result.preset).toBe(DEFAULT_ORDER_VIEW_PRESET_ID);
    expect(result.filters).toEqual(EMPTY_ORDERS_LIST_FILTERS);
  });

  it('falls back to todas without throwing for an unknown preset id', () => {
    expect(() => searchParamsToState(new URLSearchParams('vista=bogus'))).not.toThrow();
    expect(searchParamsToState(new URLSearchParams('vista=bogus')).preset).toBe('todas');
  });

  it('drops an unparseable individual filter but keeps the rest', () => {
    const params = new URLSearchParams('intentos=not-a-number&conductor=Juan');
    const result = searchParamsToState(params);
    expect(result.filters.minAttempts).toBeNull();
    expect(result.filters.driver).toBe('Juan');
  });

  it('drops a malformed boolean filter rather than throwing', () => {
    const params = new URLSearchParams('pod=maybe');
    const result = searchParamsToState(params);
    expect(result.filters.hasPod).toBeNull();
  });

  it('parses comma-separated array filters back into arrays', () => {
    const params = new URLSearchParams('estado=cancelado,parcialmente_entregado&sla=late,at_risk');
    const result = searchParamsToState(params);
    expect(result.filters.statuses).toEqual(['cancelado', 'parcialmente_entregado']);
    expect(result.filters.sla).toEqual(['late', 'at_risk']);
  });
});

describe('round trip', () => {
  const nonDefaultCases: Array<[OrderViewPresetId, Partial<OrdersListFilters>]> = [
    ['sla-en-riesgo', {}],
    ['todas', {}],
    ['en-reparto', {}],
    ['excepciones', {}],
    ['pendientes-pod', {}],
    ['reingresos', {}],
    ['entregadas-hoy', {}],
    [
      'todas',
      {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-22',
        statuses: ['en_ruta', 'listo'],
        sla: ['ok'],
        routeIds: ['r-1'],
        driver: 'Juan Pérez',
        client: 'Acme, Inc.',
        comunas: ['Ñuñoa'],
        hasPod: true,
        minAttempts: 3,
        search: 'ORD-42',
      },
    ],
  ];

  it.each(nonDefaultCases)('round-trips preset=%s filters=%j', (preset, extra) => {
    const filters: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS, ...extra };
    const params = filtersToSearchParams(preset, filters);
    const result = searchParamsToState(params);
    expect(result.preset).toBe(preset);
    expect(result.filters).toEqual(filters);
  });
});
