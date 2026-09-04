import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteTrackingVehiclePanel } from './RouteTrackingVehiclePanel';

describe('RouteTrackingVehiclePanel', () => {
  it('renders vehicle, driver and the occupancy bar when capacity is configured', () => {
    render(
      <RouteTrackingVehiclePanel
        vehicleExternalId="RTHK-72"
        driverName="Mario González"
        packagesLoadedCount={148}
        vehicleCapacityPackages={160}
      />,
    );
    expect(screen.getByText('RTHK-72')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
    expect(screen.getByText(/Ocupación con 148 paquetes/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/sin capacidad configurada/i)).not.toBeInTheDocument();
  });

  it('says "sin capacidad configurada" and draws no bar when capacity is NULL', () => {
    render(
      <RouteTrackingVehiclePanel
        vehicleExternalId="RTHK-72"
        driverName="Mario González"
        packagesLoadedCount={148}
        vehicleCapacityPackages={null}
      />,
    );
    expect(screen.getByText(/sin capacidad configurada/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders honest placeholders when there is no vehicle or driver yet', () => {
    render(
      <RouteTrackingVehiclePanel
        vehicleExternalId={null}
        driverName={null}
        packagesLoadedCount={0}
        vehicleCapacityPackages={null}
      />,
    );
    expect(screen.getByText('Sin vehículo asignado')).toBeInTheDocument();
    expect(screen.getByText('Sin conductor')).toBeInTheDocument();
  });
});
