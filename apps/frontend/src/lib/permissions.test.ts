import { describe, it, expect } from 'vitest';
import { ROLE_DEFAULT_PERMISSIONS, canLeadPickupRoute, canRemoveFromPlan, ROUTE_LEADER_ROLES } from './permissions';

describe('ROLE_DEFAULT_PERMISSIONS', () => {
  // Will mirror the handle_new_user CASE (spec-61 Task 1.2) once that
  // migration lands. If these drift, users created through /admin and
  // users created by the trigger get different permissions.
  it('gives a pickup_leader exactly what pickup_crew gets', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(['pickup']);
    expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(
      ROLE_DEFAULT_PERMISSIONS.pickup_crew,
    );
  });

  // spec-66 — the role this spec exists for. All four stations, and
  // deliberately neither management token: an ops_leader works the floor, it
  // does not answer customers or administer the operator.
  it('gives an ops_leader all four stations and no management token', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).toEqual([
      'pickup',
      'reception',
      'distribution',
      'dispatch',
    ]);
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).not.toContain('customer_service');
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).not.toContain('admin');
  });

  it('covers every role the app can assign', () => {
    expect(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort()).toEqual(
      [
        'admin',
        'loading_crew',
        'operations_manager',
        'ops_leader',
        'pickup_crew',
        'pickup_leader',
        'super_admin',
        'warehouse_staff',
      ].sort(),
    );
  });
});

describe('canLeadPickupRoute', () => {
  // The UI twin of start_pickup_route's role gate (spec-61 Task 2). The
  // database is the enforcement; this only decides what to render, so it
  // must never be MORE permissive than the RPC.
  it('is true for the roles the RPC accepts', () => {
    expect([...ROUTE_LEADER_ROLES].sort()).toEqual(
      ['admin', 'operations_manager', 'ops_leader', 'pickup_leader', 'super_admin'].sort(),
    );
    // spec-66 — matches migration 20260824000003's NOT IN list exactly.
    expect(canLeadPickupRoute('ops_leader')).toBe(true);
    expect(canLeadPickupRoute('pickup_leader')).toBe(true);
    expect(canLeadPickupRoute('operations_manager')).toBe(true);
    expect(canLeadPickupRoute('admin')).toBe(true);
    expect(canLeadPickupRoute('super_admin')).toBe(true);
  });

  it('is false for crew, for other floor roles, and for an unknown role', () => {
    expect(canLeadPickupRoute('pickup_crew')).toBe(false);
    expect(canLeadPickupRoute('warehouse_staff')).toBe(false);
    expect(canLeadPickupRoute('loading_crew')).toBe(false);
    expect(canLeadPickupRoute('some_future_role')).toBe(false);
    expect(canLeadPickupRoute(null)).toBe(false);
  });
});

describe('canRemoveFromPlan — spec-70', () => {
  it.each(['ops_leader', 'operations_manager', 'admin', 'super_admin'])(
    'allows %s',
    (role) => expect(canRemoveFromPlan(role)).toBe(true),
  );

  /**
   * The scanner operator must never be able to shrink the plan — that is the
   * entire mechanism by which "a planned package goes on the truck" holds.
   */
  it.each(['dispatch_operator', 'pickup_crew', 'warehouse', 'customer_service', ''])(
    'refuses %s',
    (role) => expect(canRemoveFromPlan(role)).toBe(false),
  );

  it('refuses a missing role', () => {
    expect(canRemoveFromPlan(null)).toBe(false);
    expect(canRemoveFromPlan(undefined)).toBe(false);
  });

  /** pickup_leader leads inbound routes and has no say over a delivery plan. */
  it('refuses pickup_leader even though it leads pickup routes', () => {
    expect(canLeadPickupRoute('pickup_leader')).toBe(true);
    expect(canRemoveFromPlan('pickup_leader')).toBe(false);
  });
});
