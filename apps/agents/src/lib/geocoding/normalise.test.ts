// src/lib/geocoding/normalise.test.ts
import { describe, it, expect } from 'vitest';
import { normaliseStreet, hashAddress } from './normalise';

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
});
