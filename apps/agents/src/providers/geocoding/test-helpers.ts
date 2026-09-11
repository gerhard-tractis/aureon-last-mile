// src/providers/geocoding/test-helpers.ts — shared fetch-mock builders for
// maptiler.test.ts and maptiler-errors.test.ts. Kept out of both test files
// so neither grows past the 300-line limit.

export function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

export function textResponse(status: number, body: string) {
  return {
    ok: status < 400,
    status,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => body,
  } as unknown as Response;
}

export function featureCollection(features: unknown[]) {
  return { type: 'FeatureCollection', features };
}
