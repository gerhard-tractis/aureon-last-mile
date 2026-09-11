// src/providers/geocoding/types.test.ts
import { describe, it, expect } from 'vitest';
import { precisionOf, GeocodingProviderError, type MaptilerErrorType } from './types';

describe('precisionOf', () => {
  it('maps exact to exact', () => {
    expect(precisionOf('exact')).toBe('exact');
  });

  it('maps coarse to approximate', () => {
    expect(precisionOf('coarse')).toBe('approximate');
  });

  it('maps wrong_comuna to approximate', () => {
    expect(precisionOf('wrong_comuna')).toBe('approximate');
  });

  it('maps uncrosscheckable to approximate', () => {
    expect(precisionOf('uncrosscheckable')).toBe('approximate');
  });
});

describe('GeocodingProviderError', () => {
  it('carries the error type it was constructed with', () => {
    const err = new GeocodingProviderError('credential', 'refused');
    const type: MaptilerErrorType = err.type;
    expect(type).toBe('credential');
    expect(err.message).toBe('refused');
    expect(err.name).toBe('GeocodingProviderError');
    expect(err).toBeInstanceOf(Error);
  });
});
