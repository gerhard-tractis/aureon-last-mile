import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchCrewRouteList } from './DispatchCrewRouteList';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

function makeRoute(overrides: Partial<RouteCard>): RouteCard {
  return {
    id: 'r1',
    code: 'R1',
    status: 'draft',
    chip: 'borrador',
    comuna: 'Santiago',
    otherComunaCount: 0,
    packagesTotal: 10,
    packagesLoaded: 0,
    percent: 0,
    loadPositionLabel: null,
    driverName: null,
    vehicleExternalId: null,
    loadedByOtherName: null,
    ...overrides,
  };
}

const routes: RouteCard[] = [
  makeRoute({ id: 'r1', code: 'R1', chip: 'tu_carga', status: 'loading' }),
  makeRoute({ id: 'r2', code: 'R2', chip: 'borrador', status: 'draft' }),
  makeRoute({ id: 'r3', code: 'R3', chip: 'lista', status: 'loaded' }),
  makeRoute({ id: 'r4', code: 'R4', chip: 'otra_cuadrilla', status: 'loading', loadedByOtherName: 'Javiera P.' }),
];

describe('DispatchCrewRouteList', () => {
  it('shows the header count and packages on dock', () => {
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/4 rutas del día · 418 paquetes en andén/)).toBeInTheDocument();
  });

  it('renders all 4 states, including the blocked route from another crew', () => {
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(screen.getByText('R3')).toBeInTheDocument();
    expect(screen.getByText('R4')).toBeInTheDocument();
    expect(screen.getByText(/la está cargando Javiera P\./)).toBeInTheDocument();
  });

  it('filters to "Mis rutas" showing only tu_carga', async () => {
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /mis rutas/i }));
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.queryByText('R2')).not.toBeInTheDocument();
  });

  it('filters to "Listas" showing only loaded routes', async () => {
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /^listas/i }));
    expect(screen.getByText('R3')).toBeInTheDocument();
    expect(screen.queryByText('R1')).not.toBeInTheDocument();
  });

  it('shows filter counts', () => {
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /todas \(4\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /mis rutas \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /listas \(1\)/i })).toBeInTheDocument();
  });

  it('calls onBack from the back button', async () => {
    const onBack = vi.fn();
    render(<DispatchCrewRouteList routes={routes} packagesOnDock={418} onOpenRoute={vi.fn()} onBack={onBack} />);
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(onBack).toHaveBeenCalled();
  });
});
