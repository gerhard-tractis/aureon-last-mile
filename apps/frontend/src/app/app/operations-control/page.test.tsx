import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OpsControlPage from './page';

// Mock next/navigation
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/app/operations-control',
}));

// Mock useOperatorId
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-1', role: 'admin', permissions: [] })),
}));

// Mock useOpsControlSnapshot
vi.mock('@/hooks/ops-control/useOpsControlSnapshot', () => ({
  useOpsControlSnapshot: vi.fn(() => ({
    snapshot: {
      orders: [],
      routes: [],
      pickups: [],
      returns: [],
      retailerSlaConfig: [],
      fetchedAt: new Date(),
    },
    isLoading: false,
    error: null,
    lastSyncAt: new Date(),
  })),
}));

// Mock useAtRiskOrders
vi.mock('@/hooks/ops-control/useAtRiskOrders', () => ({
  useAtRiskOrders: vi.fn(() => ({ orders: [], total: 0, pageCount: 1 })),
}));

// Mock useStageBreakdown
vi.mock('@/hooks/ops-control/useStageBreakdown', () => ({
  useStageBreakdown: vi.fn(() => ({
    rows: [],
    total: 0,
    pageCount: 1,
    stageHealth: { status: 'ok', delta: '', reasonsByOrder: new Map() },
  })),
}));

describe('OpsControlPage (Mission Deck)', () => {
  it('renders TopBar with Aureon branding (EN VIVO text)', () => {
    render(<OpsControlPage />);
    expect(screen.getByText('EN VIVO')).toBeDefined();
  });

  it('renders AtRiskBar with "órdenes en riesgo" text', () => {
    render(<OpsControlPage />);
    expect(screen.getByText('órdenes en riesgo')).toBeDefined();
  });

  it('renders TelemetryStrip with 7 Spanish stage buttons', () => {
    render(<OpsControlPage />);
    expect(screen.getByText('Recogida')).toBeDefined();
    expect(screen.getByText('Recepción')).toBeDefined();
    expect(screen.getByText('Consolidación')).toBeDefined();
    expect(screen.getByText('Andenes')).toBeDefined();
    expect(screen.getByText('Reparto')).toBeDefined();
    expect(screen.getByText('Devoluciones')).toBeDefined();
    expect(screen.getByText('Logística Inversa')).toBeDefined();
  });

  it('shows AtRiskList by default (no ?stage= param) with table headers', () => {
    render(<OpsControlPage />);
    expect(screen.getByText('Pedido')).toBeDefined();
    expect(screen.getByText('Cliente')).toBeDefined();
  });

  it('renders PickupPanel when Recogida stage cell is clicked', () => {
    render(<OpsControlPage />);
    const recogidaBtn = screen.getByText('Recogida');
    fireEvent.click(recogidaBtn);
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('stage=pickup'),
      { scroll: false }
    );
  });
});
