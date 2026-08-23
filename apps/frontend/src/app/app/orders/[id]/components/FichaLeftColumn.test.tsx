import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FichaLeftColumn } from './FichaLeftColumn';
import type { DossierPackage, DossierDispatch } from '@/hooks/useOrderDossier';

function pkg(overrides: Partial<DossierPackage> = {}): DossierPackage {
  return {
    id: 'p-1',
    label: 'CL7742891003',
    package_number: 'CL7742891003',
    status: 'en_ruta',
    status_updated_at: null,
    dock_zone_name: null,
    declared_weight_kg: null,
    verified_weight_kg: null,
    ...overrides,
  };
}

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'd-1',
    substatus: null,
    substatus_code: null,
    status: 'en_ruta',
    completed_at: '2026-08-13T12:41:08',
    arrived_at: null,
    estimated_at: null,
    failure_reason: null,
    latitude: null,
    longitude: null,
    raw_data: {},
    is_pickup: false,
    external_route_id: null,
    driver_name: null,
    route_id: null,
    ...overrides,
  };
}

describe('FichaLeftColumn', () => {
  it('renders delivery address, comuna and phone', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="Av. Vicuña Mackenna 8420"
        comuna="La Florida"
        customerPhone="+56984127734"
        packages={[pkg()]}
        dispatches={[]}
      />,
    );
    expect(screen.getByText(/Av\. Vicuña Mackenna 8420/)).toBeInTheDocument();
    expect(screen.getByText(/La Florida/)).toBeInTheDocument();
    expect(screen.getByText(/\+56984127734/)).toBeInTheDocument();
  });

  it('composes OrderPackageList with the real packages', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[pkg({ id: 'p-1' }), pkg({ id: 'p-2', label: 'CL2' })]}
        dispatches={[]}
      />,
    );
    expect(screen.getByTestId('order-package-list')).toBeInTheDocument();
    expect(screen.getByText('CL7742891003')).toBeInTheDocument();
    expect(screen.getByText('CL2')).toBeInTheDocument();
  });

  it('shows the courier line in ORIGEN DE LOS DATOS when there is at least one dispatch', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[dispatch()]}
      />,
    );
    expect(screen.getByText('DispatchTrack')).toBeInTheDocument();
  });

  it('omits the courier line when there are no dispatches at all', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[]}
      />,
    );
    expect(screen.queryByText('DispatchTrack')).toBeNull();
  });

  it('shows the last-webhook time derived from real dispatch timestamps', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[dispatch({ completed_at: '2026-08-13T12:41:08' })]}
      />,
    );
    expect(screen.getByText(/Último webhook/)).toBeInTheDocument();
    expect(screen.getByText('12:41:08')).toBeInTheDocument();
  });

  it('omits the last-webhook line when no dispatch carries a timestamp', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[dispatch({ completed_at: null })]}
      />,
    );
    expect(screen.queryByText(/Último webhook/)).toBeNull();
  });

  it('does not render a "Canal" line — imported_via is not in the dossier query', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[dispatch()]}
      />,
    );
    expect(screen.queryByText(/Canal/)).toBeNull();
  });

  it('does not render the "sin conserjería" address-intelligence line', () => {
    render(
      <FichaLeftColumn
        deliveryAddress="addr"
        comuna="comuna"
        customerPhone="phone"
        packages={[]}
        dispatches={[]}
      />,
    );
    expect(screen.queryByText(/conserjería/i)).toBeNull();
  });
});
