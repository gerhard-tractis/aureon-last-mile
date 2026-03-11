import { describe, it, expect } from 'vitest';
import { hasPermission, Permission } from './auth.types';

describe('hasPermission', () => {
  it('returns true when permission is present', () => {
    expect(hasPermission(['pickup', 'loading'], 'pickup')).toBe(true);
  });

  it('returns false when permission is absent', () => {
    expect(hasPermission(['pickup'], 'warehouse')).toBe(false);
  });

  it('returns false for undefined permissions', () => {
    expect(hasPermission(undefined, 'pickup')).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasPermission([], 'admin')).toBe(false);
  });

  it('works with admin permission', () => {
    const adminPerms: string[] = ['pickup', 'warehouse', 'loading', 'operations', 'admin'];
    expect(hasPermission(adminPerms, 'admin')).toBe(true);
    expect(hasPermission(adminPerms, 'pickup')).toBe(true);
  });
});
