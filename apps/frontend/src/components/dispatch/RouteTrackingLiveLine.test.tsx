import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RouteTrackingLiveLine } from './RouteTrackingLiveLine';

describe('RouteTrackingLiveLine', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the scanner name, andén, freshness and pace', () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-04T10:10:00Z');
    vi.setSystemTime(now);

    render(
      <RouteTrackingLiveLine
        scannerName="Juan Pérez"
        loadPositionLabel="A3"
        lastScanAtIso="2026-09-04T10:09:52Z"
        firstScanAtIso="2026-09-04T10:00:00Z"
        loadedBoxCount={30}
      />,
    );

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText(/último paquete hace 8 s/)).toBeInTheDocument();
    expect(screen.getByText(/ritmo 180\/h/)).toBeInTheDocument();
  });

  it('omits the andén clause when there is no load position', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:10:00Z'));

    render(
      <RouteTrackingLiveLine
        scannerName="Juan Pérez"
        loadPositionLabel={null}
        lastScanAtIso="2026-09-04T10:09:52Z"
        firstScanAtIso="2026-09-04T10:00:00Z"
        loadedBoxCount={30}
      />,
    );

    expect(screen.queryByText(/en el andén/)).not.toBeInTheDocument();
  });

  it('omits the pace clause when there is not enough elapsed time to compute one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:00:30Z'));

    render(
      <RouteTrackingLiveLine
        scannerName="Juan Pérez"
        loadPositionLabel="A3"
        lastScanAtIso="2026-09-04T10:00:28Z"
        firstScanAtIso="2026-09-04T10:00:00Z"
        loadedBoxCount={2}
      />,
    );

    expect(screen.queryByText(/ritmo/)).not.toBeInTheDocument();
  });

  // Phase-4 review — the original test set the clock once and never
  // advanced it, so it could not tell a live tick from a frozen one (rule
  // 9's actual failure mode). Same pattern as ScanFreshness.test.tsx's own
  // "ticks live on its own" test.
  it('ticks live on its own — the freshness figure recomputes without a re-render from the parent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:10:00Z'));

    render(
      <RouteTrackingLiveLine
        scannerName="Juan Pérez"
        loadPositionLabel="A3"
        lastScanAtIso="2026-09-04T10:09:52Z"
        firstScanAtIso="2026-09-04T10:00:00Z"
        loadedBoxCount={30}
      />,
    );
    expect(screen.getByText(/último paquete hace 8 s/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/último paquete hace 9 s/)).toBeInTheDocument();
  });

  // Phase-4 review — a null scannerName (RLS denial, a soft-deleted user)
  // must not take the freshness/pace figures down with it; only the name
  // clause itself is affected.
  it('renders freshness and pace even without a scanner name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T10:10:00Z'));

    render(
      <RouteTrackingLiveLine
        scannerName={null}
        loadPositionLabel="A3"
        lastScanAtIso="2026-09-04T10:09:52Z"
        firstScanAtIso="2026-09-04T10:00:00Z"
        loadedBoxCount={30}
      />,
    );

    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument();
    expect(screen.getByText(/último paquete hace 8 s/)).toBeInTheDocument();
    expect(screen.getByText(/ritmo 180\/h/)).toBeInTheDocument();
  });
});
