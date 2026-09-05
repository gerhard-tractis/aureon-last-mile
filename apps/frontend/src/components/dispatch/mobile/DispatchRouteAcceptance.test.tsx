import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/dispatch/mobile/useDispatchNextLoad', () => ({
  useDispatchNextLoad: vi.fn(),
}));

import { useDispatchNextLoad } from '@/hooks/dispatch/mobile/useDispatchNextLoad';
import { DispatchRouteAcceptance, type DispatchRouteAcceptanceProps } from './DispatchRouteAcceptance';

const BASE_PROPS: DispatchRouteAcceptanceProps = {
  routeId: 'route-1',
  operatorId: 'op-1',
  routeCode: 'RUT-0099',
  externalRouteId: 'DT-164972',
  stopsCount: 24,
  packagesDispatched: 148,
  packagesLeftAtDock: 24,
  splitOrdersCount: 2,
  onBack: vi.fn(),
  onOpenNextLoad: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  (useDispatchNextLoad as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

describe('DispatchRouteAcceptance — item 16, the acta names DT id and the 4 figures', () => {
  it('shows the DispatchTrack id', () => {
    render(<DispatchRouteAcceptance {...BASE_PROPS} />);
    expect(screen.getByText(/dt-164972/i)).toBeInTheDocument();
  });

  it('shows all four figures, each with the real value — not summarized', () => {
    render(<DispatchRouteAcceptance {...BASE_PROPS} />);
    expect(screen.getByTestId('acta-paradas')).toHaveTextContent('24');
    expect(screen.getByTestId('acta-paquetes')).toHaveTextContent('148');
    expect(screen.getByTestId('acta-anden')).toHaveTextContent('24');
    expect(screen.getByTestId('acta-partidas')).toHaveTextContent('2');
  });

  it('names what is left on the dock — sectorizado, never asignado', () => {
    render(<DispatchRouteAcceptance {...BASE_PROPS} />);
    expect(screen.getByText(/sectorizado/)).toBeInTheDocument();
    expect(screen.queryByText(/asignado\b/)).not.toBeInTheDocument();
  });

  it('with nothing left at the dock, says so instead of a false zero line', () => {
    render(<DispatchRouteAcceptance {...BASE_PROPS} packagesLeftAtDock={0} splitOrdersCount={0} />);
    expect(screen.getByText(/no quedaron paquetes en el and[eé]n/i)).toBeInTheDocument();
  });
});

describe('DispatchRouteAcceptance — item 17, a concrete next load or nothing invented', () => {
  it('offers the real next load when one exists', () => {
    (useDispatchNextLoad as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' });
    render(<DispatchRouteAcceptance {...BASE_PROPS} />);
    expect(screen.getByText('RUT-2026-0090 · Maipú')).toBeInTheDocument();
  });

  it('shows no next-load section when there is none', () => {
    (useDispatchNextLoad as ReturnType<typeof vi.fn>).mockReturnValue(null);
    render(<DispatchRouteAcceptance {...BASE_PROPS} />);
    expect(screen.queryByTestId('acta-siguiente-carga')).not.toBeInTheDocument();
  });

  it('tapping the next-load row calls onOpenNextLoad', async () => {
    const user = userEvent.setup();
    const onOpenNextLoad = vi.fn();
    (useDispatchNextLoad as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' });
    render(<DispatchRouteAcceptance {...BASE_PROPS} onOpenNextLoad={onOpenNextLoad} />);
    await user.click(screen.getByRole('button', { name: /rut-2026-0090/i }));
    expect(onOpenNextLoad).toHaveBeenCalledWith('r-90');
  });
});

describe('DispatchRouteAcceptance — back to queue', () => {
  it('tapping Volver calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<DispatchRouteAcceptance {...BASE_PROPS} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
