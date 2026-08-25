import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingSectorizationPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1', role: 'ops_leader' }),
}));

const zoneA = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  operator_id: 'op-1',
  capacity: 180,
};

const consZone = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  is_active: true,
  comunas: [],
  operator_id: 'op-1',
  capacity: null,
};

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: [zoneA, consZone] }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-a1': 169 } }),
}));

const pkg = {
  id: 'pkg-1',
  label: 'BULTO-1',
  order_id: 'order-1',
  orderNumber: '1001',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
  delivery_date: '2026-08-24',
  skuItems: [],
};

const mockGroups: Array<Record<string, unknown>> = [
  {
    zone: zoneA,
    matchResult: {
      zone_id: 'zone-a1',
      zone_name: 'Zona Norte',
      zone_code: 'A1',
      is_consolidation: false,
      reason: 'matched',
      flagged: false,
    },
    orders: [
      {
        orderId: 'order-1',
        orderNumber: '1001',
        deliveryDate: '2026-08-24',
        comunaName: 'Quilicura',
        packages: [pkg],
      },
    ],
  },
];

vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: mockGroups, isLoading: false }),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
let mockCanUse = true;
vi.mock('@/hooks/distribution/useManualDockAssignment', () => ({
  useManualDockAssignment: () => ({ canUse: mockCanUse, mutateAsync: mockMutateAsync }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockMutateAsync.mockClear();
  mockCanUse = true;
});

describe('PendingSectorizationPage (route: /app/distribution/pendientes)', () => {
  it('renders the titled header and the pending list', () => {
    render(<PendingSectorizationPage />);
    expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
    expect(screen.getByText('BULTO-1')).toBeInTheDocument();
  });

  it('the back arrow returns to the distribution home', async () => {
    const user = userEvent.setup();
    render(<PendingSectorizationPage />);
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/distribution');
  });

  it('the fixed footer offers Escanear to quicksort at the primary touch floor', () => {
    render(<PendingSectorizationPage />);
    const link = screen.getByRole('link', { name: /escanear/i });
    expect(link).toHaveAttribute('href', '/app/distribution/quicksort');
    expect(link.className).toMatch(/h-\[?(5[6-9]|60)/);
  });

  it('tapping the ⋯ affordance opens the send-to-dock sheet, and confirming assigns the package', async () => {
    const user = userEvent.setup();
    render(<PendingSectorizationPage />);
    await user.click(screen.getByRole('button', { name: /enviar bulto-1 a andén/i }));
    expect(screen.getByText('Enviar BULTO-1 a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar a A1' }));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'pkg-1', zoneId: 'zone-a1', isConsolidation: false }),
    );
  });

  it('never shows the ⋯ affordance or the sheet when canUse is false', () => {
    mockCanUse = false;
    render(<PendingSectorizationPage />);
    expect(screen.queryByRole('button', { name: /enviar/i })).not.toBeInTheDocument();
  });
});
