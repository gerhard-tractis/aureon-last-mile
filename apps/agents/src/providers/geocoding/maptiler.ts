// src/providers/geocoding/maptiler.ts — MapTiler adapter behind GeocodingProvider.
//
// Every rule below is measured, not assumed — see Fase 0 of
// docs/specs/spec-58-geocoding-foundation.md for the evidence (20 real
// Chilean addresses against the live API, 2026-09-11). Do not "simplify" this
// file back towards place_type / properties.accuracy / a relevance floor —
// Fase 0 measured all three as unusable for this decision.

import { CircuitBreaker, type CircuitBreakerOptions } from '../circuit-breaker';
import { config } from '../../config';
import {
  precisionOf,
  GeocodingProviderError,
  type GeocodeMatchClass,
  type GeocodeQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from './types';

const MAPTILER_BASE_URL = 'https://api.maptiler.com/geocoding';
const USER_AGENT = 'aureon-geo';
const REQUEST_TIMEOUT_MS = 10_000;

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

// Fase 0's 20 probes all put the comuna IN the query text ("Colon 1000,
// Concepcion"), never sent it separately, and the entire measured rule — the
// forms table, the 4-of-4 false positives, the >=80% gate threshold —
// describes that exact query shape. Composing it any other way (or leaving
// this to the caller to pre-compose) changes what MapTiler returns at the
// margin: "Colon 1000" alone is NO MATCH; "Colon 1000, Concepcion" returns a
// wrong-comuna feature. That reclassifies the case from fallback/null to
// fallback/wrong_comuna, which is precisely the Fase 6 metric this adapter
// exists to report honestly.
function buildQueryText(q: GeocodeQuery): string {
  return q.comuna ? `${q.address}, ${q.comuna}` : q.address;
}

function buildUrl(q: GeocodeQuery, apiKey: string): string {
  const encodedQuery = encodeURIComponent(buildQueryText(q));
  const params = new URLSearchParams({ key: apiKey, country: 'cl', limit: '1' });
  return `${MAPTILER_BASE_URL}/${encodedQuery}.json?${params.toString()}`;
}

// A 403 is ambiguous between a refused credential and a plan/quota limit.
// The default has to favour `credential`, because the two misclassifications
// are not symmetric against Fase 5's retry ladder: a quota-403 misread as
// `credential` latches an hour and logs loudly at error level — bounded,
// noisy, ~24 lost calls/day. A credential-403 misread as `rate_limit`
// re-arms every 30 minutes forever with NO error log — which is exactly the
// silent-forever failure the `credential` type was created to prevent. So
// only a body that *positively* names a quota/plan limit is read as
// rate_limit; everything else on a 403 is treated as a refused credential.
// Fase 0's one measured body, "Key usage restricted", matches neither
// pattern below and correctly falls through to credential by default.
function isQuotaOrPlanLimit(body: string): boolean {
  return /quota|limit exceeded|rate limit/i.test(body);
}

function classifyHttpError(status: number, body: string): GeocodingProviderError {
  if (status === 401) {
    return new GeocodingProviderError('credential', `MapTiler credential refused (401): ${body}`);
  }
  if (status === 403) {
    if (isQuotaOrPlanLimit(body)) {
      return new GeocodingProviderError('rate_limit', `MapTiler plan/rate limit (403): ${body}`);
    }
    return new GeocodingProviderError('credential', `MapTiler credential refused (403): ${body}`);
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

  // Fase 5 checks this instead of reading MAPTILER_API_KEY from config
  // itself — the provider is the one thing that knows whether it can make a
  // real call. An empty key must never reach the network: MapTiler still
  // answers with a real 403 for it, which — if left to flow through the
  // normal error path — would misclassify a permanently-absent key as a
  // one-hour credential latch instead of Fase 5's dedicated "key absent"
  // ladder row (retry at the start of next month).
  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async geocode(q: GeocodeQuery): Promise<GeocodeResult | null> {
    if (!this.isConfigured) {
      throw new GeocodingProviderError('credential', 'MAPTILER_API_KEY is not configured');
    }
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
