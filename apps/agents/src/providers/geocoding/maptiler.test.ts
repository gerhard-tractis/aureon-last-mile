// src/providers/geocoding/maptiler.test.ts — request construction and match
// classification. Error classification, circuit breaker and singleton
// behaviour live in maptiler-errors.test.ts (same module, split for size).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaptilerProvider } from './maptiler';
import { jsonResponse, featureCollection } from './test-helpers';

describe('MaptilerProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  describe('request construction', () => {
    it('sends User-Agent: aureon-geo on every request', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Los Militares 5620', comuna: 'Las Condes' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const headers = options.headers as Record<string, string>;
      expect(headers['User-Agent']).toBe('aureon-geo');
    });

    it('percent-encodes the address into the path, so an unescaped "/" never reaches the wire', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Avenida Providencia S/N', comuna: 'Providencia' });

      const [url] = fetchMock.mock.calls[0];
      expect(url as string).toContain(encodeURIComponent('Avenida Providencia S/N'));
      // The literal '/' of S/N must not survive into the path segment — only
      // the base URL's own slashes may remain (the domain and .json suffix).
      const afterGeocoding = (url as string).split('/geocoding/')[1];
      const pathOnly = afterGeocoding.split('?')[0];
      expect(pathOnly).not.toContain('/');
    });

    it('asks for exactly one feature (limit=1)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' });

      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url as string).searchParams.get('limit')).toBe('1');
    });

    it('country-biases to cl', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' });

      const [url] = fetchMock.mock.calls[0];
      expect(new URL(url as string).searchParams.get('country')).toBe('cl');
    });

    it('appends the comuna to the query text when supplied — Fase 0 measured all 20 probes this way', async () => {
      // Colon 1000 alone has no match; "Colon 1000, Concepcion" returns a
      // (wrong-comuna) feature. Sending address alone would silently change
      // which forms Fase 0's measured rule (and the Fase 6 gate) describe.
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Colon 1000', comuna: 'Concepcion' });

      const [url] = fetchMock.mock.calls[0];
      const pathOnly = decodeURIComponent(
        (url as string).split('/geocoding/')[1].split('.json')[0],
      );
      expect(pathOnly).toBe('Colon 1000, Concepcion');
    });

    it('sends the address alone when no comuna is supplied', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      await provider.geocode({ address: 'Colon 1000' });

      const [url] = fetchMock.mock.calls[0];
      const pathOnly = decodeURIComponent(
        (url as string).split('/geocoding/')[1].split('.json')[0],
      );
      expect(pathOnly).toBe('Colon 1000');
    });
  });

  describe('match classification', () => {
    it('classifies exact: house number present and comuna matches', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              address: '1234',
              center: [-70.6206, -33.4264],
              context: [{ id: 'municipality.123', text: 'Providencia' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({
        address: 'Avenida Providencia 1234',
        comuna: 'Providencia',
      });

      expect(result).not.toBeNull();
      expect(result?.matchClass).toBe('exact');
      expect(result?.precision).toBe('exact');
      expect(result?.latitude).toBe(-33.4264);
      expect(result?.longitude).toBe(-70.6206);
      expect(result?.source).toBe('maptiler');
    });

    it('classifies coarse: no house number, regardless of what context says', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              // no `address` field — street-level centroid only
              center: [-70.6206, -33.4264],
              context: [{ id: 'municipality.123', text: 'Providencia' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({
        address: 'Avenida Providencia',
        comuna: 'Providencia',
      });

      expect(result?.matchClass).toBe('coarse');
      expect(result?.precision).toBe('approximate');
    });

    it('classifies coarse (not wrong_comuna) when there is no house number even if context names another comuna', async () => {
      // This is Fase 0's measured shape for all four false positives — the
      // boundary this test protects is stated explicitly in types.ts.
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              // no `address` field
              center: [-73.0603, -36.8459],
              context: [{ id: 'municipality.456', text: 'Chiguayante' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({ address: 'Colon 1000', comuna: 'Concepcion' });

      expect(result?.matchClass).toBe('coarse');
      expect(result?.matchClass).not.toBe('wrong_comuna');
    });

    it('classifies wrong_comuna: house number present but context names another comuna', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              address: '100',
              center: [-73.2459, -39.8142],
              context: [{ id: 'municipality.789', text: 'Valdivia' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({ address: 'Arturo Prat 100', comuna: 'La Union' });

      expect(result?.matchClass).toBe('wrong_comuna');
      expect(result?.precision).toBe('approximate');
    });

    it('classifies uncrosscheckable when no comuna was supplied', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              address: '1234',
              center: [-70.6206, -33.4264],
              context: [{ id: 'municipality.123', text: 'Providencia' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({ address: 'Avenida Providencia 1234' });

      expect(result?.matchClass).toBe('uncrosscheckable');
      expect(result?.precision).toBe('approximate');
    });

    it('classifies uncrosscheckable when context has no municipality.* entry', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          featureCollection([
            {
              address: '100',
              center: [-70.6206, -33.4264],
              context: [{ id: 'region.1', text: 'Metropolitana' }],
            },
          ]),
        ),
      );
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({ address: 'Arturo Prat 100', comuna: 'La Union' });

      expect(result?.matchClass).toBe('uncrosscheckable');
    });

    it('returns null when features is empty (no match, not an error)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
      const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

      const result = await provider.geocode({ address: 'asdkjhasd 99999', comuna: 'Nowhereville' });

      expect(result).toBeNull();
    });
  });
});
