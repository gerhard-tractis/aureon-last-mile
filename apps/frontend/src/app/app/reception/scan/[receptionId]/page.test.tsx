import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionScanPage from './page';

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/hooks/reception/useReceptionScans', () => ({
  useReceptionScans: () => ({ data: [] }),
  useReceptionScanMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: () => ({ single: () => Promise.resolve({
            data: { manifest_id: 'm1', expected_count: 10, received_count: 3 },
          }) }) }),
          single: () => Promise.resolve({ data: { external_load_id: 'CARGA-001' } }),
        }),
        in: () => ({ is: () => Promise.resolve({ data: [] }) }),
      }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }),
}));
vi.mock('@/components/reception/ReceptionScanner', () => ({
  ReceptionScanner: () => <div data-testid="reception-scanner" />,
}));
vi.mock('@/components/reception/ReceptionDetailList', () => ({
  ReceptionDetailList: () => <div data-testid="detail-list" />,
  ReceptionPackageItem: {},
}));
vi.mock('@/components/pickup/PickupFlowHeader', () => ({
  PickupFlowHeader: () => <div data-testid="flow-header" />,
}));
vi.mock('@/components/reception/ReceptionStepBreadcrumb', () => ({
  ReceptionStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ receptionId: 'r-1' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('ReceptionScanPage', () => {
  it('renders breadcrumb', () => {
    render(<ReceptionScanPage />);
    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
  });

  it('renders back button as shadcn Button', () => {
    render(<ReceptionScanPage />);
    expect(screen.getByRole('button', { name: /volver a recepción/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ReceptionScanPage />);
    expect(container.firstElementChild?.className).toContain('sm:p-6');
  });
});
