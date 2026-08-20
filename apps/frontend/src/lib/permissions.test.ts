import { describe, it, expect } from 'vitest';
import { ROLE_DEFAULT_PERMISSIONS, canLeadPickupRoute, ROUTE_LEADER_ROLES } from './permissions';

describe('ROLE_DEFAULT_PERMISSIONS', () => {
  // Mirrors the CASE in handle_new_user, migration 20260820000002 (itself
  // templated on 20260811000001:100). If these drift, users created through
  // /admin and users created by the trigger get different permissions.
  it('gives a pickup_leader exactly what pickup_crew gets', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(['pickup']);
    expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(
      ROLE_DEFAULT_PERMISSIONS.pickup_crew,
    );
  });

  it('covers every role the app can assign', () => {
    expect(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort()).toEqual(
      [
        'admin',
        'loading_crew',
        'operations_manager',
        'pickup_crew',
        'pickup_leader',
        'super_admin',
        'warehouse_staff',
      ].sort(),
    );
  });
});

describe('canLeadPickupRoute', () => {
  // The UI twin of start_pickup_route's role gate (20260820000003). The
  // database is the enforcement; this only decides what to render, so it
  // must never be MORE permissive than the RPC.
  it('is true for the roles the RPC accepts', () => {
    for (const role of ROUTE_LEADER_ROLES) {
      expect(canLeadPickupRoute(role)).toBe(true);
    }
    expect([...ROUTE_LEADER_ROLES].sort()).toEqual(
      ['admin', 'operations_manager', 'pickup_leader', 'super_admin'].sort(),
    );
  });

  it('is false for crew, for other floor roles, and for an unknown role', () => {
    expect(canLeadPickupRoute('pickup_crew')).toBe(false);
    expect(canLeadPickupRoute('warehouse_staff')).toBe(false);
    expect(canLeadPickupRoute('loading_crew')).toBe(false);
    expect(canLeadPickupRoute('some_future_role')).toBe(false);
    expect(canLeadPickupRoute(null)).toBe(false);
  });
});
