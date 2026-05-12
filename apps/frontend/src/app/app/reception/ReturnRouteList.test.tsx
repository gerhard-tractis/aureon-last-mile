import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReturnRouteList } from './ReturnRouteList';

const mockUseReturnRoutes = vi.fn();

vi.mock('@/hooks/reception/useReturnRoutes', () => ({
  useReturnRoutes: (...args: unknown[]) => mockUseReturnRoutes(...args),
}));

const mockRoutes = [
  {
    externalRouteId: 'RUTA-042',
    driverName: 'Carlos López',
    packageCount: 5,
    oldestStatusUpdatedAt: '2026-05-12T08:00:00Z',
  },
  {
    externalRouteId: 'RUTA-007',
    driverName: 'Ana Ruiz',
    packageCount: 3,
    oldestStatusUpdatedAt: '2026-05-12T10:00:00Z',
  },
  {
    externalRouteId: 'RUTA-099',
    driverName: null,
    packageCount: 1,
    oldestStatusUpdatedAt: '2026-05-12T06:00:00Z',
  },
];

describe('ReturnRouteList', () => {
  const onSelectRoute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReturnRoutes.mockReturnValue({ data: mockRoutes, isLoading: false, error: null });
  });

  it('shows loading skeletons when isLoading is true', () => {
    mockUseReturnRoutes.mockReturnValue({ data: [], isLoading: true, error: null });
    const { container } = render(
      <ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />
    );
    // Skeleton renders as a div with animate-pulse class
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('shows empty state when no routes', () => {
    mockUseReturnRoutes.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />);
    expect(screen.getByText('Sin retornos pendientes')).toBeInTheDocument();
  });

  it('renders a card for each route with route id, driver name, and package count', () => {
    render(<ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />);
    expect(screen.getByText('RUTA-042')).toBeInTheDocument();
    expect(screen.getByText('Carlos López')).toBeInTheDocument();
    expect(screen.getByText('5 paquetes por recibir')).toBeInTheDocument();
    expect(screen.getByText('RUTA-007')).toBeInTheDocument();
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('3 paquetes por recibir')).toBeInTheDocument();
  });

  it('shows "Sin conductor" when driverName is null', () => {
    render(<ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />);
    expect(screen.getByText('Sin conductor')).toBeInTheDocument();
  });

  it('calls onSelectRoute with the correct externalRouteId when button clicked', () => {
    render(<ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />);
    const buttons = screen.getAllByRole('button', { name: /iniciar recepción/i });
    fireEvent.click(buttons[0]);
    // First card should be RUTA-099 (oldest: 06:00)
    expect(onSelectRoute).toHaveBeenCalledWith('RUTA-099');
  });

  it('sorts routes oldest-first by oldestStatusUpdatedAt', () => {
    render(<ReturnRouteList operatorId="op-1" onSelectRoute={onSelectRoute} />);
    const routeIds = screen
      .getAllByText(/^RUTA-\d+$/)
      .map((el) => el.textContent);
    expect(routeIds).toEqual(['RUTA-099', 'RUTA-042', 'RUTA-007']);
  });
});
