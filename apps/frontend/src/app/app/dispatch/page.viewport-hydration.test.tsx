import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// spec-76 review I3 — deliberately does NOT mock useIsBelowLg/useViewport,
// unlike page.test.tsx. `useIsBelowLg` starts at its SSR-safe `false` and
// only flips inside a post-hydration effect (hooks/useViewport.ts), so the
// FIRST commit is always desktop regardless of the real viewport — this
// exercises that with the real hook.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/app/dispatch',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1' }),
}));

const desktopBoardRenderSpy = vi.fn();
vi.mock('@/components/dispatch/DispatchDesktopBoard', () => ({
  DispatchDesktopBoard: (props: unknown) => {
    desktopBoardRenderSpy(props);
    return React.createElement('div', { 'data-testid': 'dispatch-desktop-board-stub' });
  },
}));

vi.mock('@/components/dispatch/mobile/DispatchCrewMobileRoot', () => ({
  DispatchCrewMobileRoot: () => React.createElement('div', { 'data-testid': 'dispatch-crew-mobile-root-stub' }),
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('DispatchPage — real useIsBelowLg hydration (spec-76 review I1/I3)', () => {
  it('mounts DispatchDesktopBoard on the first commit, then swaps to the crew mobile tree once the real viewport resolves below lg', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('1023px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { default: DispatchPage } = await import('./page');
    renderWithClient(<DispatchPage />);

    // The transient desktop mount that is unavoidable with this mechanism.
    expect(desktopBoardRenderSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('dispatch-crew-mobile-root-stub')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('dispatch-desktop-board-stub')).not.toBeInTheDocument();
  });
});
