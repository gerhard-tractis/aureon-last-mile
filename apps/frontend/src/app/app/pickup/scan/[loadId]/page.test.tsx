import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
const mockPush = vi.fn();
const mockParams = { loadId: 'CARGA-001' };
vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
}));

// Mock hooks
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'manifest-1', total_packages: 10 } }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }),
}));

vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: () => ({ data: [] }),
  useScanMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/pickup/useManifestOrders', () => ({
  useManifestOrders: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: () => <div data-testid="manifest-detail-list" />,
}));

vi.mock('@/components/pickup/ScannerInput', () => ({
  ScannerInput: () => <div data-testid="scanner-input" />,
}));

vi.mock('@/components/pickup/ProgressBar', () => ({
  ProgressBar: () => <div data-testid="progress-bar" />,
}));

vi.mock('@/components/pickup/ScanHistoryList', () => ({
  ScanHistoryList: () => <div data-testid="scan-history-list" />,
}));

vi.mock('@/components/pickup/ScanResultPopup', () => ({
  ScanResultPopup: () => null,
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

import ScanningPage from './page';

describe('ScanningPage', () => {
  it('renders back arrow that navigates to /app/pickup', () => {
    render(<ScanningPage />);
    const backButton = screen.getByLabelText('Back to manifests');
    fireEvent.click(backButton);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup');
  });

  it('renders ManifestDetailList', () => {
    render(<ScanningPage />);
    expect(screen.getByTestId('manifest-detail-list')).toBeInTheDocument();
  });
});
