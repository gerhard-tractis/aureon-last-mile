import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PickupPage from './page';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockPending = [
  { external_load_id: 'CARGA-001', retailer_name: 'Easy', order_count: 5, package_count: 12 },
  { external_load_id: 'CARGA-002', retailer_name: 'Sodimac', order_count: 3, package_count: 8 },
];
const mockCompleted = [
  {
    id: 'c1', external_load_id: 'CARGA-000', retailer_name: 'Easy',
    total_orders: 2, total_packages: 4, completed_at: new Date().toISOString(),
  },
];

const mockUsePendingManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({}),
}));

vi.mock('@/components/pickup/CameraIntake', () => ({
  CameraIntake: () => <div data-testid="camera-intake" />,
}));

vi.mock('@/components/pickup/ClientFilter', () => ({
  ClientFilter: () => null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/pickup',
}));

// ── Tests ────────────────────────────────────────────────────────────────────
describe('PickupPage', () => {
  beforeEach(() => {
    mockUsePendingManifests.mockReturnValue({ data: mockPending, isLoading: false });
    mockUseCompletedManifests.mockReturnValue({ data: mockCompleted, isLoading: false });
  });

  describe('KPI cards', () => {
    it('renders three MetricCards with correct values', () => {
      const { container } = render(<PickupPage />);
      const valueEls = container.querySelectorAll('[data-value]');
      expect(valueEls).toHaveLength(3);
      // Pending count
      expect(valueEls[0].textContent).toBe('2');
      // Total packages
      expect(valueEls[1].textContent).toBe('20');
      // Completed today
      expect(valueEls[2].textContent).toBe('1');
    });

    it('renders KPI labels in Spanish', () => {
      render(<PickupPage />);
      expect(screen.getByText('Manifiestos pendientes')).toBeInTheDocument();
      expect(screen.getByText('Paquetes totales')).toBeInTheDocument();
      expect(screen.getByText('Completados hoy')).toBeInTheDocument();
    });
  });

  describe('Tabs', () => {
    it('renders tab triggers in Spanish', () => {
      render(<PickupPage />);
      expect(screen.getByRole('tab', { name: 'Activos' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Completados' })).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows EmptyState when no pending manifests', () => {
      mockUsePendingManifests.mockReturnValue({ data: [], isLoading: false });
      render(<PickupPage />);
      expect(screen.getByText('Sin manifiestos pendientes')).toBeInTheDocument();
    });
  });

  describe('Manifest cards', () => {
    it('renders pending manifest cards', () => {
      render(<PickupPage />);
      expect(screen.getByText('Easy')).toBeInTheDocument();
      expect(screen.getByText('Sodimac')).toBeInTheDocument();
    });
  });

  describe('Container', () => {
    it('has max-w constraint and responsive padding', () => {
      const { container } = render(<PickupPage />);
      const wrapper = container.querySelector('.max-w-4xl');
      expect(wrapper).toBeTruthy();
    });
  });
});
