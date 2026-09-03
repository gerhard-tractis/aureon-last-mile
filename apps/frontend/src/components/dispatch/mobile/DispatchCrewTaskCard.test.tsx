import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchCrewTaskCard } from './DispatchCrewTaskCard';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

const baseTask: RouteCard = {
  id: 'route-123456789',
  code: 'ROUTE-12',
  status: 'loading',
  chip: 'tu_carga',
  comuna: 'San Miguel',
  otherComunaCount: 0,
  packagesTotal: 172,
  packagesLoaded: 148,
  percent: 86,
  loadPositionLabel: 'Andén A3',
  driverName: null,
  vehicleExternalId: null,
  loadedByOtherName: null,
};

describe('DispatchCrewTaskCard', () => {
  it('shows the progress, comuna and andén', () => {
    render(<DispatchCrewTaskCard task={baseTask} onContinue={vi.fn()} />);
    expect(screen.getByText('148 de 172')).toBeInTheDocument();
    expect(screen.getByText('86%')).toBeInTheDocument();
    expect(screen.getByText(/San Miguel/)).toBeInTheDocument();
    expect(screen.getByText(/Andén A3/)).toBeInTheDocument();
  });

  // spec-76 review I7 — routes.driver_name is only ever written by the
  // dispatch handler, after `loaded`; every route this card can show today
  // has it NULL. This fixture covers the post-dispatch-handler future the
  // card is READY for, not a state a route showing this card can be in now
  // (see the "Sin conductor" test just below for what actually renders
  // today).
  it('renders the driver once populated (post-dispatch future — NULL for every route today)', () => {
    render(<DispatchCrewTaskCard task={{ ...baseTask, driverName: 'Mario González' }} onContinue={vi.fn()} />);
    expect(screen.getByText('Mario González')).toBeInTheDocument();
  });

  it('says "Sin conductor" rather than fabricating a name pre-dispatch', () => {
    render(<DispatchCrewTaskCard task={baseTask} onContinue={vi.fn()} />);
    expect(screen.getByText('Sin conductor')).toBeInTheDocument();
  });

  it('appends the extra-comuna count instead of asserting a single false comuna', () => {
    render(<DispatchCrewTaskCard task={{ ...baseTask, otherComunaCount: 2 }} onContinue={vi.fn()} />);
    expect(screen.getByText(/San Miguel \+2/)).toBeInTheDocument();
  });

  it('calls onContinue with the route id when "Seguir escaneando" is pressed', async () => {
    const onContinue = vi.fn();
    render(<DispatchCrewTaskCard task={baseTask} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('button', { name: /seguir escaneando/i }));
    expect(onContinue).toHaveBeenCalledWith('route-123456789');
  });
});
