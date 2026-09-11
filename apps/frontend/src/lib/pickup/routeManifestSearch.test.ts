import { describe, it, expect } from 'vitest';
import { matchesRouteManifestQuery, hasActiveRouteSearchQuery } from './routeManifestSearch';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

const ACME: RouteManifestRow = {
  id: 'm1',
  external_load_id: 'LOAD-1',
  retailer_name: 'Acme',
  pickup_location: 'Bodega Norte',
  total_orders: 1,
  total_packages: 2,
  verified_count: 0,
};

describe('matchesRouteManifestQuery', () => {
  it('matches by retailer_name, case-insensitive', () => {
    expect(matchesRouteManifestQuery(ACME, 'acme')).toBe(true);
  });

  it('matches by external_load_id', () => {
    expect(matchesRouteManifestQuery(ACME, 'LOAD-1')).toBe(true);
  });

  it('matches by pickup_location', () => {
    expect(matchesRouteManifestQuery(ACME, 'Bodega Norte')).toBe(true);
  });

  it('una query vacía matchea todo', () => {
    expect(matchesRouteManifestQuery(ACME, '')).toBe(true);
  });

  it('un manifiesto sin pickup_location no revienta ni matchea de más', () => {
    expect(
      matchesRouteManifestQuery({ ...ACME, pickup_location: null }, 'algo-que-no-calza'),
    ).toBe(false);
  });

  // M1 (review) — el predicado recorta ESPACIOS antes de comparar, igual
  // que el gate `hasActiveRouteSearchQuery`. Sin este `trim()` interno, una
  // query con espacio final (plausible con un lector que no recorta) no
  // matchea aunque el gate externo la trate como búsqueda activa.
  it('recorta espacios en la query antes de comparar (mismatch con el gate externo, no equivalente)', () => {
    expect(matchesRouteManifestQuery(ACME, 'Acme ')).toBe(true);
    expect(matchesRouteManifestQuery(ACME, '  Acme')).toBe(true);
  });
});

describe('hasActiveRouteSearchQuery', () => {
  it('una query de sólo espacios no cuenta como búsqueda activa', () => {
    expect(hasActiveRouteSearchQuery('   ')).toBe(false);
  });

  it('una query con contenido real cuenta como búsqueda activa', () => {
    expect(hasActiveRouteSearchQuery('Acme')).toBe(true);
  });
});
