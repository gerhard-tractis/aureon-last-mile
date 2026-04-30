import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranslation } from './useTranslation';

describe('useTranslation', () => {
  it('resolves a known key', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('dispatch.coming_soon')).toBe('Despacho — Próximamente');
  });

  it('falls back to key string for unknown key', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('some.unknown.key')).toBe('some.unknown.key');
  });

  it('interpolates named placeholders', () => {
    const { result } = renderHook(() => useTranslation());
    // orders.count has a {count} placeholder in the dictionary
    expect(result.current.t('orders.count', { count: 5 })).toBe('5 órdenes');
  });
});
