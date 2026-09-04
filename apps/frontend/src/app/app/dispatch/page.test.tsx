import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * spec-76 review I1 — this page is now a thin two-branch component
 * (operatorId gate, then desktop/mobile). The desktop board's own data
 * hooks (KPIs, pre-ruta snapshot, route creation) and their behaviour tests
 * moved to `components/dispatch/DispatchDesktopBoard.test.tsx`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/dispatch',
  useSearchParams: () => new URLSearchParams(),
}));

let mockOperatorId: string | null = 'op-1';
let mockUserId: string | null = 'user-1';
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: mockOperatorId, userId: mockUserId }),
}));

// spec-76 review I1 test 1 (Fase 1) — defaults to the desktop branch, same
// SSR-safe default every other useIsBelowLg consumer's tests rely on.
let mockIsBelowLg = false;
vi.mock('@/hooks/useViewport', () => ({
  useIsBelowLg: () => mockIsBelowLg,
}));

vi.mock('@/components/dispatch/mobile/DispatchCrewMobileRoot', () => ({
  DispatchCrewMobileRoot: ({ operatorId, userId }: { operatorId: string | null; userId: string | null }) =>
    React.createElement('div', { 'data-testid': 'dispatch-crew-mobile-root-stub' }, `${operatorId}:${userId}`),
}));

const desktopBoardRenderSpy = vi.fn();
vi.mock('@/components/dispatch/DispatchDesktopBoard', () => ({
  DispatchDesktopBoard: (props: { operatorId: string }) => {
    desktopBoardRenderSpy(props);
    return React.createElement('div', { 'data-testid': 'dispatch-desktop-board-stub' }, props.operatorId);
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  mockIsBelowLg = false;
  mockOperatorId = 'op-1';
  mockUserId = 'user-1';
  desktopBoardRenderSpy.mockClear();
});

describe('DispatchPage — operator loading gate', () => {
  it('shows the module skeleton while operatorId is not yet resolved, mounting neither branch', async () => {
    mockOperatorId = null;
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(screen.queryByTestId('dispatch-desktop-board-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-crew-mobile-root-stub')).not.toBeInTheDocument();
  });
});

describe('DispatchPage — spec-76 viewport branch', () => {
  it('mounts DispatchDesktopBoard at or above lg (default)', async () => {
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(screen.getByTestId('dispatch-desktop-board-stub')).toHaveTextContent('op-1');
    expect(screen.queryByTestId('dispatch-crew-mobile-root-stub')).not.toBeInTheDocument();
  });

  it('mounts DispatchCrewMobileRoot, and only that, below lg', async () => {
    mockIsBelowLg = true;
    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);
    expect(screen.getByTestId('dispatch-crew-mobile-root-stub')).toHaveTextContent('op-1:user-1');
    expect(screen.queryByTestId('dispatch-desktop-board-stub')).not.toBeInTheDocument();
  });
});
