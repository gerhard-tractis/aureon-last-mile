import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchCrewRouteCard } from './DispatchCrewRouteCard';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

const base: RouteCard = {
  id: 'route-1',
  code: 'ROUTE-1',
  status: 'loading',
  chip: 'tu_carga',
  comuna: 'San Miguel',
  otherComunaCount: 0,
  packagesTotal: 100,
  packagesLoaded: 40,
  percent: 40,
  loadPositionLabel: 'Andén A3',
  driverName: null,
  vehicleExternalId: null,
  loadedByOtherName: null,
};

describe('DispatchCrewRouteCard', () => {
  it('is never exposed as a button in the accessibility tree (Lecciones #4)', () => {
    render(<DispatchCrewRouteCard route={base} onOpen={vi.fn()} />);
    // The only accessible button is the explicit action button, not the card.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /route-1/i })).not.toBeInTheDocument();
  });

  it('fires onOpen exactly once when the action button is clicked (Lecciones #6)', async () => {
    const onOpen = vi.fn();
    render(<DispatchCrewRouteCard route={base} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /continuar carga/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('route-1');
  });

  it('fires onOpen once when the card itself (not the button) is clicked', async () => {
    const onOpen = vi.fn();
    render(<DispatchCrewRouteCard route={base} onOpen={onOpen} />);
    await userEvent.click(screen.getByText('ROUTE-1'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['borrador', 'Abrir y asignar vehículo'],
    ['lista', 'Despachar'],
  ] as const)('shows the right action label for chip %s', (chip, label) => {
    render(<DispatchCrewRouteCard route={{ ...base, chip }} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('a route being loaded by another crew renders but does not open (decision 9)', async () => {
    const onOpen = vi.fn();
    render(
      <DispatchCrewRouteCard
        route={{ ...base, chip: 'otra_cuadrilla', loadedByOtherName: 'Javiera P.' }}
        onOpen={onOpen}
      />,
    );
    expect(screen.getByText(/la está cargando Javiera P\./)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('dispatch-crew-route-card'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
