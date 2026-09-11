// src/providers/geocoding/types.ts — Provider-agnostic geocoding contract.
// Fase 0 (docs/specs/spec-58-geocoding-foundation.md) measured MapTiler's
// response shape against real Chilean addresses before this interface was
// written. The doc comments below record what was rejected and why — do not
// simplify them away in a later pass.
//
// GeocodingProviderError / MaptilerErrorType live HERE, not in maptiler.ts,
// on purpose: Fase 5's retry ladder needs to read a provider's error type to
// pick a row, and if that type only existed in the concrete adapter, Fase 5
// would import `from '.../geocoding/maptiler'` to get it — coupling
// orchestration to one vendor and contradicting Decision 1's "swapping
// provider is a single adapter file". Any future provider constructs the
// same GeocodingProviderError; only the *values* it produces differ.

import type { ProviderErrorType } from '../types';

// A refused credential is not a transient outage (see maptiler.ts's error
// classification), so it must not share a bucket with 'api_error' or
// 'network'. Extending the shared ProviderErrorType here — rather than
// adding 'credential' to ProviderErrorType itself — keeps that value out of
// LLMError's vocabulary, where it would never be constructed.
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

export interface GeocodeQuery {
  address: string;
  /** Canonical comuna name, resolved from orders.comuna_id by Fase 5.
   *  Optional because orders.comuna_id is nullable and that case is real —
   *  when absent the adapter cannot cross-check, and says so via matchClass. */
  comuna?: string;
  region?: string;
}

/** Why the adapter reached its verdict. Fase 5 needs this, not just `precision`:
 *  `wrong_comuna` and `uncrosscheckable` are both 'approximate' yet take
 *  OPPOSITE dispositions in the ladder — one discards the point, the other keeps
 *  it. With only `precision` the worker cannot tell them apart without
 *  re-parsing `raw`, which would drag MapTiler's response shape back into the
 *  orchestration layer that "En qué capa se decide" deliberately keeps it out of. */
export type GeocodeMatchClass =
  | 'exact' // house number matched AND comuna cross-check passed
  | 'coarse' // no house number — whatever context[] says about the comuna
  | 'wrong_comuna' // house number PRESENT but context[] names another comuna
  | 'uncrosscheckable'; // a point, but no comuna to check against, or no municipality.* in context[]

// The coarse / wrong_comuna boundary is load-bearing and easy to get backwards.
// `wrong_comuna` REQUIRES `feature.address` to be present. A comuna mismatch with
// no house number is `coarse`, full stop — even though context[] does name another
// comuna. Both take the same disposition in the ladder, so getting it wrong is not
// a behaviour bug; it corrupts the Fase 6 metric instead. All four of Fase 0's
// measured mismatches had NO house number, so classifying them `wrong_comuna`
// would fill the very counter the cross-check is on trial for with cases the
// cross-check did not decide — and absolve it using the evidence that it was
// unnecessary.

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  matchClass: GeocodeMatchClass;
  /** Derived, kept because it is what lands in the column:
   *  'exact' when matchClass === 'exact', otherwise 'approximate'.
   *  Never write this by hand — derive it with precisionOf(matchClass), exported
   *  from this file and unit-tested over all four classes. A hand-built result
   *  carrying matchClass:'uncrosscheckable' with precision:'exact' would not
   *  merely draw a bad pin: the cache write predicate is the match class, but
   *  anything that reads `precision` to decide durability freezes an unverified
   *  point into the one structure this spec admits it cannot cheaply undo. */
  precision: 'exact' | 'approximate';
  source: string;
  raw?: unknown;
}

export interface GeocodingProvider {
  readonly name: string;
  geocode(q: GeocodeQuery): Promise<GeocodeResult | null>;
}

/** The only place matchClass -> precision is decided. See GeocodeResult.precision. */
export function precisionOf(matchClass: GeocodeMatchClass): 'exact' | 'approximate' {
  return matchClass === 'exact' ? 'exact' : 'approximate';
}
