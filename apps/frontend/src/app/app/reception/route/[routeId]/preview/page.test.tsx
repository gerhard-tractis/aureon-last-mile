import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RoutePreviewPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ routeId: 'r1' }),
  useRouter: () => ({ push: mockPush }),
}));

const mockPreview = vi.fn();
vi.mock('@/hooks/reception/useRoutePreview', () => ({
  useRoutePreview: (...args: unknown[]) => mockPreview(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

const mockOpenMutate = vi.fn();
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => ({ mutate: mockOpenMutate, isPending: false }),
}));

const preview = {
  id: 'r1',
  code: 'PR-2026-0001',
  status: 'in_progress',
  started_at: '2026-06-25T06:00:00Z',
  driver_name: 'Ana Ruiz',
  vehicle_plate: 'AAA-111',
  manifest_count: 2,
  scanned_count: 7,
};

describe('RoutePreviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockReturnValue({ data: preview, isLoading: false, error: null });
  });

  it('renders the read-only preview card', () => {
    render(<RoutePreviewPage />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/AAA-111/)).toBeInTheDocument();
    expect(screen.getByText(/7 paquetes escaneados/)).toBeInTheDocument();
  });

  it('opens NO reception session on mount', () => {
    render(<RoutePreviewPage />);
    expect(mockOpenMutate).not.toHaveBeenCalled();
  });

  it('offers the manual receive fallback but does not fire it', () => {
    render(<RoutePreviewPage />);
    expect(screen.getByRole('button', { name: /recibir sin qr/i })).toBeInTheDocument();
    expect(mockOpenMutate).not.toHaveBeenCalled();
  });

  it('renders a loading skeleton', () => {
    mockPreview.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<RoutePreviewPage />);
    expect(
      container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length,
    ).toBeGreaterThan(0);
  });

  it('renders an error state when the route cannot be loaded', () => {
    mockPreview.mockReturnValue({ data: null, isLoading: false, error: null });
    render(<RoutePreviewPage />);
    expect(screen.getByText('No se pudo cargar la ruta')).toBeInTheDocument();
  });
});
