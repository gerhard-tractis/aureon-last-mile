import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchCrewHome } from './DispatchCrewHome';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

const task: RouteCard = {
  id: 'route-1',
  code: 'ROUTE-1',
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

const queueRoute: RouteCard = { ...task, id: 'route-2', code: 'ROUTE-2', chip: 'borrador', comuna: 'Ñuñoa' };

describe('DispatchCrewHome', () => {
  it('renders a loading skeleton, not the empty task card, while data is in flight', () => {
    render(
      <DispatchCrewHome
        isLoading
        myTask={null}
        queue={[]}
        shift={{ scannedToday: 0, ratePerHour: null }}
        lastDispatched={null}
        onContinueTask={vi.fn()}
        onChooseRoute={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dispatch-crew-home-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-crew-task-card')).not.toBeInTheDocument();
  });

  it('shows the dark task card with progress when a task is in progress', () => {
    render(
      <DispatchCrewHome
        isLoading={false}
        myTask={task}
        queue={[]}
        shift={{ scannedToday: 12, ratePerHour: 34 }}
        lastDispatched={null}
        onContinueTask={vi.fn()}
        onChooseRoute={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dispatch-crew-task-card')).toBeInTheDocument();
    expect(screen.getByText('148 de 172')).toBeInTheDocument();
  });

  it('renders no empty dark card and offers to choose a route when there is no task', async () => {
    const onChooseRoute = vi.fn();
    render(
      <DispatchCrewHome
        isLoading={false}
        myTask={null}
        queue={[]}
        shift={{ scannedToday: 0, ratePerHour: null }}
        lastDispatched={null}
        onContinueTask={vi.fn()}
        onChooseRoute={onChooseRoute}
      />,
    );
    expect(screen.queryByTestId('dispatch-crew-task-card')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /elegir ruta/i }));
    expect(onChooseRoute).toHaveBeenCalled();
  });

  it('shows shift metrics and the "después de esta" queue', () => {
    render(
      <DispatchCrewHome
        isLoading={false}
        myTask={task}
        queue={[queueRoute]}
        shift={{ scannedToday: 12, ratePerHour: 34 }}
        lastDispatched={null}
        onContinueTask={vi.fn()}
        onChooseRoute={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dispatch-crew-shift-stats')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('34/h')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-crew-queue-list')).toBeInTheDocument();
    expect(screen.getByText('ROUTE-2')).toBeInTheDocument();
  });

  it('reports the last dispatched route in a closing line', () => {
    render(
      <DispatchCrewHome
        isLoading={false}
        myTask={null}
        queue={[]}
        shift={{ scannedToday: 0, ratePerHour: null }}
        lastDispatched={{ code: 'ABCDEF12', timeLabel: '08:41' }}
        onContinueTask={vi.fn()}
        onChooseRoute={vi.fn()}
      />,
    );
    expect(screen.getByText(/Último despacho: ABCDEF12 a las 08:41/)).toBeInTheDocument();
  });
});
