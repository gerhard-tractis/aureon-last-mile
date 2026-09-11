// src/lib/geocoding/normalise.test.ts
import { describe, it, expect } from 'vitest';
import { normaliseStreet, normaliseText, hashAddress, NORMALISATION_VERSION } from './normalise';

describe('normaliseStreet', () => {
  it('lowercases and strips accents', () => {
    expect(normaliseStreet('Ñuñoa Ávila')).toBe('nunoa avila');
  });

  it('expands av. and avda. to avenida', () => {
    expect(normaliseStreet('Av. Providencia 1234')).toBe('avenida providencia 1234');
    expect(normaliseStreet('Avda. Providencia 1234')).toBe('avenida providencia 1234');
  });

  it('expands pje. to pasaje', () => {
    expect(normaliseStreet('Pje. Los Aromos 22')).toBe('pasaje los aromos 22');
  });

  it('collapses repeated whitespace', () => {
    expect(normaliseStreet('Av.   Providencia    1234')).toBe('avenida providencia 1234');
  });

  it('strips punctuation', () => {
    expect(normaliseStreet('Providencia, 1234 - depto. 5')).toBe('providencia 1234');
  });

  it('produces the same normalised string for two spellings of one address', () => {
    const a = normaliseStreet('Av. Providencia 1234');
    const b = normaliseStreet('avenida   PROVIDENCIA 1234');
    expect(a).toBe(b);
  });

  it('strips the unit component (depto) so two units at the same address normalise identically', () => {
    const a = normaliseStreet('Av. Providencia 1234 depto 42');
    const b = normaliseStreet('Av. Providencia 1234 depto 7');
    expect(a).toBe(b);
    expect(a).toBe('avenida providencia 1234');
  });

  it('strips dpto, departamento, oficina, of. and piso unit variants', () => {
    const base = 'avenida providencia 1234';
    expect(normaliseStreet('Av. Providencia 1234 dpto 7')).toBe(base);
    expect(normaliseStreet('Av. Providencia 1234 departamento 7')).toBe(base);
    expect(normaliseStreet('Av. Providencia 1234 oficina 7')).toBe(base);
    expect(normaliseStreet('Av. Providencia 1234 of. 7')).toBe(base);
    expect(normaliseStreet('Av. Providencia 1234 piso 7')).toBe(base);
  });

  // Review finding 1: UNIT_RE had no closing \b after the keyword itself,
  // so it matched as a bare prefix and swallowed the rest of a real street
  // word (or the following word) as if it were the unit id. Each case here
  // is a real street name that happens to start with, or equal, a unit
  // keyword.
  it('does not eat a street name that starts with a unit keyword', () => {
    expect(normaliseStreet('Ofelia 123')).toBe('ofelia 123');
    expect(normaliseStreet('Av. Ofelia Ruiz 500')).toBe('avenida ofelia ruiz 500');
    expect(normaliseStreet('Calle Oficial Mayor 10')).toBe('calle oficial mayor 10');
    expect(normaliseStreet('Pasaje Los Departamentos 45')).toBe('pasaje los departamentos 45');
    expect(normaliseStreet('Piso Firme 23')).toBe('piso firme 23');
    expect(normaliseStreet('Pisoni 300')).toBe('pisoni 300');
    expect(normaliseStreet('El Ofertorio 8')).toBe('el ofertorio 8');
  });

  it('still strips a real unit id immediately after a longer keyword prefix (no regression)', () => {
    // "Departamental" contains "departamento" only as a false prefix (it
    // diverges at the 12th character), so this was never actually at risk,
    // but it is the case the review called out by name to keep unchanged.
    expect(normaliseStreet('Av. Departamental 1234')).toBe('avenida departamental 1234');
  });
});

describe('hashAddress', () => {
  it('produces the same hash for two spellings of one address', () => {
    const a = hashAddress('Av. Providencia 1234', 'Santiago');
    const b = hashAddress('avenida   PROVIDENCIA 1234', 'santiago');
    expect(a).toBe(b);
  });

  it('produces the same hash for depto 42 and depto 7 at the same street address', () => {
    const a = hashAddress('Av. Providencia 1234 depto 42', 'Santiago');
    const b = hashAddress('Av. Providencia 1234 depto 7', 'Santiago');
    expect(a).toBe(b);
  });

  it('produces different hashes for different streets', () => {
    const a = hashAddress('Av. Providencia 1234', 'Santiago');
    const b = hashAddress('Av. Providencia 5678', 'Santiago');
    expect(a).not.toBe(b);
  });

  it('produces different hashes for different comunas at the same street', () => {
    const a = hashAddress('Av. Providencia 1234', 'Santiago');
    const b = hashAddress('Av. Providencia 1234', 'Providencia');
    expect(a).not.toBe(b);
  });

  it('is a sha256 hex digest (64 lowercase hex chars)', () => {
    const a = hashAddress('Av. Providencia 1234', 'Santiago');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  // Review finding 2: nothing pinned the normaliser's behaviour to a
  // literal digest, so a change to normaliseStreet could pass all the
  // relative (a === b / a !== b) tests above while silently orphaning
  // every row cached under the current NORMALISATION_VERSION -- not a
  // unique-constraint conflict, just a key nobody queries again, in a
  // table with no purge procedure.
  //
  // Round-2 review (N4) removed two tests that sat here and could not
  // fail: `expect(hashAddress.length).toBe(2)` would catch an added
  // *required* parameter but not a version with a default (`version = 1`,
  // which is how one would actually get added -- a default does not count
  // toward Function.length), and an `f(x) === f(x)` self-equality check is
  // trivially true regardless of what hashAddress does. Real coverage for
  // both claims already exists and doesn't need simulating here:
  //   - "the hash has no version parameter" is exactly what the pinned
  //     digest below tests: it calls hashAddress with only (street, comuna)
  //     and checks a literal output, which is only meaningful because
  //     there is no third argument to also pin.
  //   - "two normalisation_version rows coexist for one address_hash" is
  //     spec-58 fase 1's pgTAP TEST 13/14
  //     (packages/database/supabase/tests/spec58_geocoding.sql) -- the
  //     UNIQUE (address_hash, normalisation_version) constraint and its
  //     coexistence behaviour are a DB-level guarantee, not something a
  //     pure-function unit test can assert about the schema.
  it('pins the v1 digest for a known address -- if this fails, bump NORMALISATION_VERSION', () => {
    const digest = hashAddress('Av. Providencia 1234', 'Santiago');
    expect(digest).toBe('d3b59ddd585bddeb2f6878254d71d4199c73af00a747b3608e21a039964e5f9f');
    expect(NORMALISATION_VERSION).toBe(1);
  });
});

describe('normaliseText', () => {
  it('lowercases, strips accents, strips punctuation and collapses whitespace', () => {
    expect(normaliseText('Ñuñoa,  Ávila.')).toBe('nunoa avila');
  });

  it('does NOT expand av./avda./pje. abbreviations (that is a street-only rule)', () => {
    expect(normaliseText('Av. Providencia')).toBe('av providencia');
  });

  it('does NOT strip unit-looking tokens (a comuna name is never a unit)', () => {
    expect(normaliseText('Piso 5')).toBe('piso 5');
  });
});
