import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchCrewMobileRoot } from './DispatchCrewMobileRoot';
import type { RouteCard } from '@/lib/dispatch/mobile/crew-board';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('@/hooks/useCurrentUserName', () => ({ useCurrentUserName: () => ({ data: 'Marco S.' }) }));

let mockBoard: {
  routes: RouteCard[];
  myTask: RouteCard | null;
  queue: RouteCard[];
  shift: { scannedToday: number; ratePerHour: number | null };
  lastDispatched: { code: string; timeLabel: string } | null;
  packagesOnDock: number;
} | undefined;
let mockIsLoading = false;
vi.mock('@/hooks/dispatch/mobile/useCrewLoadingBoard', () => ({
  useCrewLoadingBoard: () => ({ data: mockBoard, isLoading: mockIsLoading }),
}));

const task: RouteCard = {
  id: 'route-1',
  code: 'ROUTE-1',
  status: 'loading',
  chip: 'tu_carga',
  comuna: 'San Miguel',
  otherComunaCount: 0,
  packagesTotal: 10,
  packagesLoaded: 5,
  percent: 50,
  loadPositionLabel: 'A3',
  driverName: null,
  vehicleExternalId: null,
  loadedByOtherName: null,
};

describe('DispatchCrewMobileRoot', () => {
  it('renders the home view by default, with header + task card', () => {
    mockBoard = { routes: [task], myTask: task, queue: [], shift: { scannedToday: 0, ratePerHour: null }, lastDispatched: null, packagesOnDock: 5 };
    render(<DispatchCrewMobileRoot operatorId="op-1" userId="u1" />);
    expect(screen.getByText('Hola, Marco S.')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-crew-task-card')).toBeInTheDocument();
  });

  it('navigates to the route list and back, keeping the header (EN LÍNEA) on both views', async () => {
    mockBoard = { routes: [], myTask: null, queue: [], shift: { scannedToday: 0, ratePerHour: null }, lastDispatched: null, packagesOnDock: 0 };
    render(<DispatchCrewMobileRoot operatorId="op-1" userId="u1" />);
    expect(screen.getByText('EN LÍNEA')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /elegir ruta/i }));
    expect(screen.getByTestId('dispatch-crew-route-list')).toBeInTheDocument();
    // spec-76 review M2 — the header used to live only inside the home
    // branch's returned tree, so it vanished the moment 2b mounted.
    expect(screen.getByText('EN LÍNEA')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(screen.getByTestId('dispatch-crew-mobile-root')).toBeInTheDocument();
  });

  it('pushes to the route detail page when a task is continued', async () => {
    mockBoard = { routes: [task], myTask: task, queue: [], shift: { scannedToday: 0, ratePerHour: null }, lastDispatched: null, packagesOnDock: 5 };
    render(<DispatchCrewMobileRoot operatorId="op-1" userId="u1" />);
    await userEvent.click(screen.getByRole('button', { name: /seguir escaneando/i }));
    expect(pushMock).toHaveBeenCalledWith('/app/dispatch/route-1');
  });
});
