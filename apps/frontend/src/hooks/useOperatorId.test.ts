import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOperatorId } from './useOperatorId';

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: vi.fn(),
}));

import { useGlobal } from '@/lib/context/GlobalContext';

describe('useOperatorId', () => {
  it('returns operatorId, role, and permissions from GlobalContext', () => {
    (useGlobal as ReturnType<typeof vi.fn>).mockReturnValue({
      operatorId: 'op-abc',
      role: 'admin',
      permissions: ['read', 'write'],
      user: { id: 'user-abc', email: 'a@b.c', registered_at: new Date() },
    });

    const { result } = renderHook(() => useOperatorId());

    expect(result.current.operatorId).toBe('op-abc');
    expect(result.current.role).toBe('admin');
    expect(result.current.permissions).toEqual(['read', 'write']);
    // spec-61 Task 5 — auth.uid(), the same value pickup_routes.driver_id
    // carries for a route's leader.
    expect(result.current.userId).toBe('user-abc');
  });

  it('returns null operatorId when user is not authenticated', () => {
    (useGlobal as ReturnType<typeof vi.fn>).mockReturnValue({
      operatorId: null,
      role: null,
      permissions: [],
      user: null,
    });

    const { result } = renderHook(() => useOperatorId());

    expect(result.current.operatorId).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.permissions).toEqual([]);
    // Never `undefined`: callers compare it against a route's driver_id, and
    // `undefined === undefined` on a route row with no driver would read as
    // "this is my route".
    expect(result.current.userId).toBeNull();
  });

  it('reflects updated context values on re-render', () => {
    (useGlobal as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ operatorId: 'op-1', role: 'operator', permissions: ['read'] })
      .mockReturnValue({ operatorId: 'op-2', role: 'admin', permissions: ['read', 'write'] });

    const { result, rerender } = renderHook(() => useOperatorId());
    expect(result.current.operatorId).toBe('op-1');

    rerender();
    expect(result.current.operatorId).toBe('op-2');
    expect(result.current.role).toBe('admin');
  });
});
