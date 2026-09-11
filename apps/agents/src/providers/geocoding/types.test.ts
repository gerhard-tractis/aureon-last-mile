// src/providers/geocoding/types.test.ts
import { describe, it, expect } from 'vitest';
import { precisionOf } from './types';

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
