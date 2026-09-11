// src/providers/geocoding/maptiler.ts — MapTiler adapter behind GeocodingProvider.
//
// Every rule below is measured, not assumed — see Fase 0 of
// docs/specs/spec-58-geocoding-foundation.md for the evidence (20 real
// Chilean addresses against the live API, 2026-09-11). Do not "simplify" this
// file back towards place_type / properties.accuracy / a relevance floor —
// Fase 0 measured all three as unusable for this decision.

import { CircuitBreaker, type CircuitBreakerOptions } from '../circuit-breaker';
import type { ProviderErrorType } from '../types';
import { config } from '../../config';
import {
  precisionOf,
  type GeocodeMatchClass,
  type GeocodeQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from './types';

const MAPTILER_BASE_URL = 'https://api.maptiler.com/geocoding';
const USER_AGENT = 'aureon-geo';
const REQUEST_TIMEOUT_MS = 10_000;

// Fase 5's retry ladder needs a third bucket beyond ProviderErrorType: a
// refused credential is not a transient outage (see maptiler.ts's error
// classification below), so it must not share a bucket with 'api_error' or
// 'network'. Extending here — rather than adding 'credential' to the shared
// ProviderErrorType — keeps that value out of LLMError's vocabulary, where it
// would never be constructed.
export type MaptilerErrorType = ProviderErrorType | 'credential';

export class GeocodingProviderError extends Error {
  constructor(
    public readonly type: MaptilerErrorType,
    message: string,
  ) {
    super(message);
    this.name = 'GeocodingProviderError';
  }
}

interface MaptilerContextEntry {
  id?: string;
  text?: string;
}

interface MaptilerFeature {
  address?: string;
  center?: [number, number];
  geometry?: { coordinates?: [number, number] };
  context?: MaptilerContextEntry[];
}

interface MaptilerFeatureCollection {
  features?: MaptilerFeature[];
}

function normalizeComunaText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMunicipalityText(context: MaptilerContextEntry[] | undefined): string | undefined {
  if (!Array.isArray(context)) return undefined;
  const entry = context.find((c) => typeof c.id === 'string' && c.id.startsWith('municipality.'));
  return entry?.text;
}

// The exact rule Fase 0 measured. Do not substitute place_type (returns
// ['address'] even for the wrong comuna), properties.accuracy (absent in all
// 20 measured responses), or a relevance floor (no threshold separates the
// correct 0.667 match from the 1.0/0.994 street centroids).
function classify(feature: MaptilerFeature, requestedComuna: string | undefined): GeocodeMatchClass {
  const hasAddress = typeof feature.address === 'string' && feature.address.length > 0;

  if (!requestedComuna) {
    return 'uncrosscheckable';
  }

  const municipalityText = findMunicipalityText(feature.context);
  if (municipalityText === undefined) {
    return 'uncrosscheckable';
  }

  const matches = normalizeComunaText(municipalityText) === normalizeComunaText(requestedComuna);

  if (hasAddress) {
    return matches ? 'exact' : 'wrong_comuna';
  }
  // No house number: coarse regardless of whether the comuna matched — a
  // comuna mismatch with no house number is NOT wrong_comuna. See the
  // boundary comment on GeocodeMatchClass in ./types.ts.
  return 'coarse';
}

function buildUrl(q: GeocodeQuery, apiKey: string): string {
  const encodedAddress = encodeURIComponent(q.address);
  const params = new URLSearchParams({ key: apiKey, country: 'cl', limit: '1' });
  return `${MAPTILER_BASE_URL}/${encodedAddress}.json?${params.toString()}`;
}

// Fase 0 measured the exact refusal body for a User-Agent-restricted key:
// "Key usage restricted". A plan/quota 403 is expected to read differently —
// no mention of the key or token — but that has not been observed live: no
// MapTiler key is available to this phase (see the spec's Fase 4 section,
// "But 403 is ambiguous..."). This is the discriminator this phase commits
// to on the evidence available; escalate before relying on it against a real
// quota rejection.
function isCredentialRefusal(body: string): boolean {
  return /\bkey\b/i.test(body) || /\btoken\b/i.test(body) || /credential/i.test(body);
}

function classifyHttpError(status: number, body: string): GeocodingProviderError {
  if (status === 401) {
    return new GeocodingProviderError('credential', `MapTiler credential refused (401): ${body}`);
  }
  if (status === 403) {
    if (isCredentialRefusal(body)) {
      return new GeocodingProviderError('credential', `MapTiler credential refused (403): ${body}`);
    }
    return new GeocodingProviderError('rate_limit', `MapTiler plan/rate limit (403): ${body}`);
  }
  if (status === 429) {
    return new GeocodingProviderError('rate_limit', `MapTiler rate limited (429): ${body}`);
  }
  return new GeocodingProviderError('api_error', `MapTiler HTTP ${status}: ${body}`);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

// A refused credential never clears on its own within a short window, so it
// gets a finite one-hour latch rather than the normal recoveryTimeout — see
// CircuitBreaker.trip(). One hour, not "until restart": 403 is ambiguous
// between a refused key and a plan/rate limit, and a permanent latch would
// turn a transient rate-limit into a month of centroid fallbacks.
const CREDENTIAL_TRIP_LATCH_MS = 60 * 60 * 1000;

export class MaptilerProvider implements GeocodingProvider {
  readonly name = 'maptiler';
  private readonly breaker: CircuitBreaker<GeocodeResult | null>;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    breakerOptions?: Partial<CircuitBreakerOptions>,
  ) {
    this.breaker = new CircuitBreaker<GeocodeResult | null>(
      (...args: unknown[]) => this.rawGeocode(args[0] as GeocodeQuery),
      breakerOptions,
    );
  }

  async geocode(q: GeocodeQuery): Promise<GeocodeResult | null> {
    try {
      return await this.breaker.execute(q);
    } catch (err) {
      if (err instanceof GeocodingProviderError && err.type === 'credential') {
        this.breaker.trip(CREDENTIAL_TRIP_LATCH_MS);
      }
      if (err instanceof GeocodingProviderError) {
        throw err;
      }
      // The breaker's own "Circuit breaker is open" Error, or anything else
      // unexpected — still a transport failure, never "no match".
      throw new GeocodingProviderError(
        'network',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async rawGeocode(q: GeocodeQuery): Promise<GeocodeResult | null> {
    const url = buildUrl(q, this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GeocodingProviderError('timeout', 'MapTiler request timed out');
      }
      throw new GeocodingProviderError(
        'network',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      throw classifyHttpError(response.status, body);
    }

    let json: MaptilerFeatureCollection;
    try {
      json = (await response.json()) as MaptilerFeatureCollection;
    } catch {
      throw new GeocodingProviderError('api_error', 'MapTiler returned malformed JSON');
    }

    const features = json.features;
    if (!Array.isArray(features) || features.length === 0) {
      return null;
    }

    const feature = features[0];
    const coords = feature.center ?? feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
      throw new GeocodingProviderError('api_error', 'MapTiler feature missing coordinates');
    }
    const [longitude, latitude] = coords;

    const matchClass = classify(feature, q.comuna);

    return {
      latitude,
      longitude,
      matchClass,
      precision: precisionOf(matchClass),
      source: this.name,
      raw: feature,
    };
  }
}

// Module-scoped singleton — see the spec's Fase 4: "the provider and its
// breaker are module-scoped, one instance per process, not one per job".
// CircuitBreaker keeps its state in private instance fields, so a per-job
// construction would make its latch last exactly one call.
let instance: MaptilerProvider | null = null;

export function getMaptilerProvider(): MaptilerProvider {
  if (!instance) {
    const apiKey = config?.MAPTILER_API_KEY;
    if (!apiKey) {
      // Loud, not fatal: a geocoding key must not be able to take down the
      // agent suite. Fase 5 resolves every order to a comuna centroid
      // instead — but that is a silent degradation unless someone reads the
      // logs, so this is an error-level line, not a debug one.
      console.error(
        'MAPTILER_API_KEY is not set — geocoding will resolve every order to its comuna centroid.',
      );
    }
    instance = new MaptilerProvider(apiKey ?? '');
  }
  return instance;
}
