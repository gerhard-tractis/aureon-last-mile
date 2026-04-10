import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/app/operations-control',
}));

// Mock hooks
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: vi.fn(() => ({ operatorId: 'op-1', role: 'admin', permissions: [] })),
}));
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
}));
vi.mock('@/hooks/useRealtimeStatus', () => ({
  useRealtimeStatus: vi.fn(() => 'connected' as const),
}));

// Mock child components
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
    <div data-testid="page-shell"><h1>{title}</h1>{actions}{children}</div>
  ),
}));
vi.mock('@/components/operations-control/RealtimeStatusIndicator', () => ({
  RealtimeStatusIndicator: ({ status }: { status: string }) => (
    <span data-testid="realtime-indicator">{status}</span>
  ),
}));
vi.mock('@/components/operations-control/mobile/MobileOCC', () => ({
  MobileOCC: () => <div data-testid="mobile-occ" />,
}));
vi.mock('./components/OpsControlDesktop', () => ({
  OpsControlDesktop: () => <div data-testid="ops-desktop" />,
}));

import OpsControlPage from './page';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOperatorId } from '@/hooks/useOperatorId';

describe('OpsControlPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders PageShell with title on desktop', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('page-shell')).toBeDefined();
    expect(screen.getByText('Control de Operaciones')).toBeDefined();
    expect(screen.getByTestId('ops-desktop')).toBeDefined();
  });

  it('renders RealtimeStatusIndicator in actions', () => {
    render(<OpsControlPage />);
    expect(screen.getByTestId('realtime-indicator')).toBeDefined();
  });

  it('renders MobileOCC on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<OpsControlPage />);
    expect(screen.getByTestId('mobile-occ')).toBeDefined();
    expect(screen.queryByTestId('page-shell')).toBeNull();
  });

  it('renders loading when no operatorId', () => {
    vi.mocked(useOperatorId).mockReturnValue({ operatorId: null } as ReturnType<typeof useOperatorId>);
    render(<OpsControlPage />);
    expect(screen.getByText('Cargando...')).toBeDefined();
  });
});
