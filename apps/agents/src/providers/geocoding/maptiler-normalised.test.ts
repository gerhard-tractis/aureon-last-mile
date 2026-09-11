// src/providers/geocoding/maptiler-normalised.test.ts — Fase 0's 20 probes
// used RAW text; Fase 5 sends NORMALISED text (Fase 3: lowercase, accents
// stripped, punctuation stripped). Re-sampled live against the real API
// 2026-09-11 (coordinator, holds the key) to check Fase 0's measured rule
// transfers to what Fase 5 will actually send:
//
//   Colon 1000, Concepcion                            -> Chiguayante, addr absent
//   colon 1000, Concepción                            -> identical
//   colon 1000, Concepcion                            -> identical
//   Avenida Providencia 1234, Providencia             -> addr=1234, Providencia
//   avenida providencia 1234 providencia, Providencia -> identical (comuna duplicated)
//   avenida providencia 1234, Providencia             -> identical
//   avenida providencia s n, Providencia              -> identical to raw S/N
//
// Normalised text behaved identically to raw in every case, including the
// duplicated-comuna form (orders.delivery_address routinely already contains
// the comuna) and S/N -> "s n" (punctuation stripped, so the
// encodeURIComponent slash trap never reaches the wire — but is kept
// regardless, since it's correct independent of which text arrives).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaptilerProvider } from './maptiler';
import { jsonResponse, featureCollection } from './test-helpers';

describe('MaptilerProvider normalised input (Fase 0 re-sampling holds — coordinator, 2026-09-11)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('does not deduplicate the comuna when the address already contains it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await provider.geocode({
      address: 'avenida providencia 1234 providencia',
      comuna: 'Providencia',
    });

    const [url] = fetchMock.mock.calls[0];
    const pathOnly = decodeURIComponent((url as string).split('/geocoding/')[1].split('.json')[0]);
    expect(pathOnly).toBe('avenida providencia 1234 providencia, Providencia');
  });

  it('composes normalised S/N ("s n", no slash) with the comuna the same way as any other address', async () => {
    fetchMock.mockResolvedValue(jsonResponse(featureCollection([])));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await provider.geocode({ address: 'avenida providencia s n', comuna: 'Providencia' });

    const [url] = fetchMock.mock.calls[0];
    const pathOnly = decodeURIComponent((url as string).split('/geocoding/')[1].split('.json')[0]);
    expect(pathOnly).toBe('avenida providencia s n, Providencia');
  });

  it('the comuna cross-check is case- and accent-insensitive (normalised "Concepcion" vs accented "Concepción")', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        featureCollection([
          {
            address: '1234',
            center: [-70.6206, -33.4264],
            // Response carries the accented form, as MapTiler returns it.
            context: [{ id: 'municipality.123', text: 'Concepción' }],
          },
        ]),
      ),
    );
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    // Fase 3 sends the requested comuna already normalised (no accent).
    const result = await provider.geocode({ address: 'colon 1000', comuna: 'concepcion' });

    expect(result?.matchClass).toBe('exact');
  });
});
