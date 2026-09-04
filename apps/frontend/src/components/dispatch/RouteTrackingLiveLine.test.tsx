import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
