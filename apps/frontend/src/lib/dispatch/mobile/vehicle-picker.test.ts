import { describe, it, expect } from 'vitest';
import { buildVehiclePickerRows, isCapacityConfigured, type PickerFleetVehicle, type PickerBusyRoute } from './vehicle-picker';

function makeVehicle(overrides: Partial<PickerFleetVehicle>): PickerFleetVehicle {
  return {
    id: 'v1',
    externalVehicleId: 'RTHK-72',
    plateNumber: null,
    vehicleType: 'Camión 3/4',
    driverName: null,
    capacityPackages: 240,
    ...overrides,
  };
}

describe('isCapacityConfigured', () => {
  it('treats null, zero, negative, and non-finite as unconfigured', () => {
    expect(isCapacityConfigured(null)).toBe(false);
    expect(isCapacityConfigured(0)).toBe(false);
    expect(isCapacityConfigured(-5)).toBe(false);
    expect(isCapacityConfigured(NaN)).toBe(false);
    expect(isCapacityConfigured(Infinity)).toBe(false);
  });

  it('treats a positive finite number as configured', () => {
    expect(isCapacityConfigured(240)).toBe(true);
  });
});

describe('buildVehiclePickerRows', () => {
  it('marks a vehicle with no capacity configured as not assignable — never a fake bar (decision 6)', () => {
    const vehicles = [makeVehicle({ id: 'v1', capacityPackages: null })];
    const rows = buildVehiclePickerRows(vehicles, [], 'route-current');
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'v1',
        assignable: false,
        blockReason: 'no_capacity',
        blockedByRouteCode: null,
      }),
    ]);
  });

  it('marks a vehicle already carrying another route today as blocked and visible, naming the route', () => {
    const vehicles = [makeVehicle({ id: 'v1', capacityPackages: 240 })];
    const busyRoutes: PickerBusyRoute[] = [
      { vehicleId: 'v1', routeId: 'other-route', routeCode: 'RUT-0088' },
    ];
    const rows = buildVehiclePickerRows(vehicles, busyRoutes, 'route-current');
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'v1',
        assignable: false,
        blockReason: 'blocked',
        blockedByRouteCode: 'RUT-0088',
      }),
    ]);
  });

  it('does not block a vehicle busy only on the route being edited right now', () => {
    const vehicles = [makeVehicle({ id: 'v1', capacityPackages: 240 })];
    const busyRoutes: PickerBusyRoute[] = [
      { vehicleId: 'v1', routeId: 'route-current', routeCode: 'RUT-0090' },
    ];
    const rows = buildVehiclePickerRows(vehicles, busyRoutes, 'route-current');
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: 'v1', assignable: true, blockReason: null, blockedByRouteCode: null }),
    );
  });

  it('marks a fully configured, free vehicle as assignable', () => {
    const vehicles = [makeVehicle({ id: 'v1', capacityPackages: 240 })];
    const rows = buildVehiclePickerRows(vehicles, [], 'route-current');
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: 'v1', assignable: true, blockReason: null, blockedByRouteCode: null }),
    );
  });

  it('prefers naming the blocking route over the capacity gap when both apply', () => {
    const vehicles = [makeVehicle({ id: 'v1', capacityPackages: null })];
    const busyRoutes: PickerBusyRoute[] = [
      { vehicleId: 'v1', routeId: 'other-route', routeCode: 'RUT-0088' },
    ];
    const rows = buildVehiclePickerRows(vehicles, busyRoutes, 'route-current');
    expect(rows[0]).toEqual(
      expect.objectContaining({ blockReason: 'blocked', blockedByRouteCode: 'RUT-0088' }),
    );
  });

  it('carries through identity, type and driver fields untouched', () => {
    const vehicles = [
      makeVehicle({
        id: 'v1',
        externalVehicleId: 'RTHK-72',
        plateNumber: 'RTHK-72',
        vehicleType: 'Camión 3/4',
        driverName: 'Mario González',
        capacityPackages: 240,
      }),
    ];
    const rows = buildVehiclePickerRows(vehicles, [], null);
    expect(rows[0]).toMatchObject({
      externalVehicleId: 'RTHK-72',
      plateNumber: 'RTHK-72',
      vehicleType: 'Camión 3/4',
      driverName: 'Mario González',
      capacityPackages: 240,
    });
  });
});
