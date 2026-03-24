import { describe, it, expect } from 'vitest';
import { hasPermission, Permission, RolePermissions, UserRole } from './auth.types';

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

describe('canPerformDispatch', () => {
  it('returns true for loading_crew', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.LOADING_CREW)).toBe(true);
  });

  it('returns true for operations_manager', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.OPERATIONS_MANAGER)).toBe(true);
  });

  it('returns true for admin', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.ADMIN)).toBe(true);
  });

  it('returns false for pickup_crew', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.PICKUP_CREW)).toBe(false);
  });

  it('returns false for warehouse_staff', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.WAREHOUSE_STAFF)).toBe(false);
  });
});
