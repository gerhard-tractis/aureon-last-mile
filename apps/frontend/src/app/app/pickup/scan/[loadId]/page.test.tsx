import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScanningPage from './page';

// Mock all dependencies
const mockUsePickupScans = vi.fn();
const mockUseScanMutation = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
  useScanMutation: (...args: unknown[]) => mockUseScanMutation(...args),
}));

const mockUseManifestOrders = vi.fn();
vi.mock('@/hooks/pickup/useManifestOrders', () => ({
  useManifestOrders: (...args: unknown[]) => mockUseManifestOrders(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              single: () => Promise.resolve({ data: { id: 'm1', total_packages: 10 } }),
            }),
          }),
        }),
      }),
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  }),
}));

vi.mock('@/components/pickup/ScannerInput', () => ({
  ScannerInput: () => <div data-testid="scanner-input" />,
}));

vi.mock('@/components/pickup/ScanHistoryList', () => ({
  ScanHistoryList: () => <div data-testid="scan-history" />,
}));

vi.mock('@/components/pickup/ScanResultPopup', () => ({
  ScanResultPopup: () => null,
}));

vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: () => <div data-testid="manifest-detail" />,
}));

vi.mock('@/components/pickup/PickupFlowHeader', () => ({
  PickupFlowHeader: () => <div data-testid="flow-header" />,
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('ScanningPage', () => {
  beforeEach(() => {
    mockUsePickupScans.mockReturnValue({ data: [
      { id: 's1', scan_result: 'verified', package_id: 'p1', barcode_scanned: 'BC001' },
      { id: 's2', scan_result: 'not_found', package_id: null, barcode_scanned: 'BC999' },
    ] });
    mockUseScanMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseManifestOrders.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('renders Spanish text for "not in manifest" counter', () => {
    render(<ScanningPage />);
    expect(screen.getByText(/no encontrados? en manifiesto/i)).toBeInTheDocument();
  });

  it('renders "Escaneos recientes" section header', () => {
    render(<ScanningPage />);
    expect(screen.getByText('Escaneos recientes')).toBeInTheDocument();
  });

  it('renders "Continuar a revisión" button', () => {
    render(<ScanningPage />);
    expect(screen.getByRole('button', { name: /continuar a revisión/i })).toBeInTheDocument();
  });

  it('renders back button with Spanish aria-label', () => {
    render(<ScanningPage />);
    expect(screen.getByRole('button', { name: /volver a manifiestos/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ScanningPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });
});
