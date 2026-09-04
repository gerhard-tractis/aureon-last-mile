import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DispatchRouteSurface } from './DispatchRouteSurface';
import type { FleetVehicle } from '@/lib/dispatch/types';

// spec-76 review I3 — deliberately does NOT mock useIsBelowLg/useViewport.
// Every other spec-76 suite does, which made the transient desktop mount
// I2's fixed comment documents invisible to CI: `useIsBelowLg` starts at
// its SSR-safe `false` and only flips inside a post-hydration effect
// (hooks/useViewport.ts), so the FIRST commit is always desktop regardless
// of the real viewport — this test exercises that with the real hook.

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const routeBuilderRenderSpy = vi.fn();
vi.mock('./RouteBuilder', () => ({
  RouteBuilder: (props: unknown) => {
    routeBuilderRenderSpy(props);
    return <div data-testid="route-builder-stub" />;
  },
}));

vi.mock('./mobile/DispatchRouteBeforeScan', () => ({
  DispatchRouteBeforeScan: () => <div data-testid="before-scan-stub" />,
}));

vi.mock('@/hooks/dispatch/mobile/useRouteLoadBrief', () => ({
  useRouteLoadBrief: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const vehicles: FleetVehicle[] = [];
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('DispatchRouteSurface — real useIsBelowLg hydration (spec-76 review I2/I3)', () => {
  it('mounts RouteBuilder on the first commit, then swaps to the crew mobile tree once the real viewport resolves below lg', async () => {
    // `(max-width: 1023px)` (useViewport.ts's BELOW_LG_QUERY) matches; the
    // other two queries it also reads do not.
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

    render(<DispatchRouteSurface routeId="route-1" operatorId="op-1" vehicles={vehicles} />);

    // The transient desktop mount spec-76 I2's comment documents.
    expect(routeBuilderRenderSpy).toHaveBeenCalled();

    // Settled tree, after useViewport's effect resolves the real (mobile)
    // viewport, is the crew tree — not RouteBuilder.
    await waitFor(() => {
      expect(screen.getByTestId('before-scan-stub')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('route-builder-stub')).not.toBeInTheDocument();
  });

  it('stays on RouteBuilder when the real viewport resolves at or above lg', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // below-lg query does not match — desktop viewport
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    render(<DispatchRouteSurface routeId="route-1" operatorId="op-1" vehicles={vehicles} />);

    await waitFor(() => {
      expect(routeBuilderRenderSpy).toHaveBeenCalled();
    });
    expect(screen.getByTestId('route-builder-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('before-scan-stub')).not.toBeInTheDocument();
  });
});
