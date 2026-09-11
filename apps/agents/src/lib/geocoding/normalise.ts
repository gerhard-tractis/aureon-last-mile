// src/lib/geocoding/normalise.ts — address normalisation, spec-58 fase 3
//
// This is normalisation v1 (docs/specs/spec-58-geocoding-foundation.md,
// "Fase 3"). The output of `normaliseStreet` is dual-purpose: it is both
// half of the geocode_cache key (joined with the comuna as `street|comuna`
// before hashing) AND the text sent to the provider on the wire (fase 4).
// The `|` separator belongs to the cache key only and is never sent.
//
// A version bump lives here, not as an input to the hash: `hashAddress`
// deliberately does not take a `normalisation_version` parameter — see
// spec-58 fase 1's `geocode_cache.normalisation_version` column comment.
import { createHash } from 'crypto';

// The hash never takes this as a parameter (see the module comment above),
// but a version bump still has to be applied by every caller that writes
// or reads geocode_cache -- exporting it here means fase 4/5 import one
// constant instead of each hardcoding the literal `1`, which is how a
// version bump would end up applied halfway.
export const NORMALISATION_VERSION = 1;

// Unit component per Decision 3: street-level geocoding returns one point
// for every flat in a building, so keying the cache on the unit would turn
// one paid lookup into forty. Matches the keyword, an optional trailing
// period, optional "n"/"nro"/"#" marker, and the unit id.
//
// Two things this depends on, both found by review:
//   - \b immediately after the keyword group. Without it "of"/"piso" match
//     as a bare PREFIX of a real word ("ofelia", "oficial", "pisoni",
//     "ofertorio") and the id pattern below then swallows the rest of that
//     word (or the next one) trying to satisfy its own trailing \b.
//   - the id itself requires a digit ([a-z]?\d[a-z0-9-]* rather than
//     [a-z0-9-]+). A unit id is never bare letters ("Piso Firme",
//     "Oficial Mayor" are street names, not a unit + id), so requiring a
//     digit is what actually distinguishes a unit suffix from an ordinary
//     following word once the keyword itself can no longer over-match.
const UNIT_RE =
  /\b(?:depto|dpto|departamento|oficina|of|piso)\b\.?\s*(?:n[°º]?r?o?\.?)?\s*#?\s*[a-z]?\d[a-z0-9-]*\b/gi;

// `av.` / `avda.` -> `avenida`, `pje.` -> `pasaje` (Decision 3 / fase 3
// normalisation table). Applied before punctuation is stripped so the
// optional trailing period is still visible to match against.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bavda\.?\b/gi, 'avenida'],
  [/\bav\.?\b/gi, 'avenida'],
  [/\bpje\.?\b/gi, 'pasaje'],
];

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normalises a street address string: lowercase, accent-stripped,
 * abbreviation-expanded, unit-stripped, punctuation-stripped, whitespace-
 * collapsed. This is the string that both goes on the wire to the
 * geocoding provider (fase 4) and forms half of the geocode_cache key.
 */
export function normaliseStreet(raw: string): string {
  let value = stripAccents(raw.toLowerCase());

  for (const [pattern, replacement] of ABBREVIATIONS) {
    value = value.replace(pattern, replacement);
  }

  value = value.replace(UNIT_RE, ' ');

  // Strip punctuation: keep only letters, digits and whitespace.
  value = value.replace(/[^a-z0-9\s]/g, ' ');

  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Plain text normalisation with none of `normaliseStreet`'s street-only
 * rules: no av./avda./pje. abbreviation expansion, no unit stripping. A
 * comuna name is never a unit and is never abbreviated the way a street
 * is, so reusing `normaliseStreet` for it would mean a change to the unit
 * regex silently changes comuna comparison too. Exported for fase 4, which
 * needs it to compare `GeocodeQuery.comuna` against a provider response's
 * municipality field.
 */
export function normaliseText(raw: string): string {
  let value = stripAccents(raw.toLowerCase());
  value = value.replace(/[^a-z0-9\s]/g, ' ');
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * sha256 of the normalised `street|comuna` key. `comuna` is expected to
 * already be resolved to a canonical value by `public.normalize_comuna_id`
 * (Postgres) — this function does not re-implement comuna matching, it
 * only applies the same plain text normalisation so casing/accent variants
 * of the same canonical comuna hash identically.
 */
export function hashAddress(street: string, comuna: string): string {
  const key = `${normaliseStreet(street)}|${normaliseText(comuna)}`;
  return createHash('sha256').update(key).digest('hex');
}
