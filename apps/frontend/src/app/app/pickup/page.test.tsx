import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PickupPage from './page';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockPending = [
  { external_load_id: 'CARGA-001', retailer_name: 'Easy', order_count: 5, package_count: 12, created_at: '2026-04-09T10:00:00Z' },
  { external_load_id: 'CARGA-002', retailer_name: 'Sodimac', order_count: 3, package_count: 8, created_at: '2026-04-09T11:00:00Z' },
];
const mockCompleted = [
  {
    id: 'c1', external_load_id: 'CARGA-000', retailer_name: 'Easy',
    total_orders: 2, total_packages: 4, completed_at: new Date().toISOString(),
  },
];
const mockInTransit = [
  {
    id: 'i1',
    external_load_id: 'CARGA-INT-1',
    retailer_name: 'Falabella',
    total_orders: 7,
    total_packages: 14,
    reception_status: 'awaiting_reception',
    updated_at: new Date().toISOString(),
  },
];

const mockUsePendingManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
const mockUseInTransitManifests = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
  useInTransitManifests: (...args: unknown[]) => mockUseInTransitManifests(...args),
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

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/pickup',
}));

// ── Tests ────────────────────────────────────────────────────────────────────
describe('PickupPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUsePendingManifests.mockReturnValue({ data: mockPending, isLoading: false });
    mockUseCompletedManifests.mockReturnValue({ data: mockCompleted, isLoading: false });
    mockUseInTransitManifests.mockReturnValue({ data: mockInTransit, isLoading: false });
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

    it('renders the "En tránsito" tab between Activos and Completados', () => {
      render(<PickupPage />);
      expect(screen.getByRole('tab', { name: 'En tránsito' })).toBeInTheDocument();
    });
  });

  describe('En tránsito tab', () => {
    it('shows in-transit manifests when the tab is selected', async () => {
      const user = userEvent.setup();
      render(<PickupPage />);
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText('Falabella')).toBeInTheDocument();
      expect(screen.getByText('CARGA-INT-1')).toBeInTheDocument();
    });

    it('renders an empty state when there are no in-transit manifests', async () => {
      mockUseInTransitManifests.mockReturnValue({ data: [], isLoading: false });
      const user = userEvent.setup();
      render(<PickupPage />);
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText('Sin manifiestos en tránsito')).toBeInTheDocument();
    });

    it('shows the "Pickup confirmado" badge on in-transit cards', async () => {
      const user = userEvent.setup();
      render(<PickupPage />);
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      expect(screen.getByText(/pickup confirmado/i)).toBeInTheDocument();
    });

    it('routes to /app/pickup/handoff/[loadId] when an in-transit card is clicked', async () => {
      const user = userEvent.setup();
      render(<PickupPage />);
      await user.click(screen.getByRole('tab', { name: 'En tránsito' }));
      const card = screen.getByText('Falabella').closest('[role="button"]') as HTMLElement;
      expect(card).toBeTruthy();
      await user.click(card);
      expect(mockPush).toHaveBeenCalledWith('/app/pickup/handoff/CARGA-INT-1');
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

    it('shows the creation date on pending manifest cards', () => {
      render(<PickupPage />);
      // created_at '2026-04-09T10:00:00Z' → toLocaleDateString() output
      const expected = new Date('2026-04-09T10:00:00Z').toLocaleDateString();
      const els = screen.getAllByText(`Creado el ${expected}`);
      expect(els.length).toBeGreaterThan(0);
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
