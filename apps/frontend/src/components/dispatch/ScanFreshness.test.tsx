import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScanFreshness } from './ScanFreshness';

describe('ScanFreshness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "último escaneo" freshness when not stalled', () => {
    const lastScanAtIso = new Date('2026-09-03T11:59:52Z').toISOString();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    vi.useFakeTimers();
    render(<ScanFreshness lastScanAtIso={lastScanAtIso} stalled={false} />);
    expect(screen.getByText('último escaneo 8 s')).toBeInTheDocument();
  });

  it('renders "sin escaneos" staleness when stalled', () => {
    const lastScanAtIso = new Date('2026-09-03T11:46:00Z').toISOString();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    vi.useFakeTimers();
    render(<ScanFreshness lastScanAtIso={lastScanAtIso} stalled={true} />);
    expect(screen.getByText('sin escaneos 14 min')).toBeInTheDocument();
  });

  it(
    'ticks live on its own — rule 9\'s actual failure mode (the monitor freezing at mount) end-to-end, ' +
      'with the REAL useNowTick, not a mocked/frozen `now`',
    () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
      const lastScanAtIso = new Date('2026-09-03T11:59:52Z').toISOString(); // 8s ago at mount
      render(<ScanFreshness lastScanAtIso={lastScanAtIso} stalled={false} />);
      expect(screen.getByText('último escaneo 8 s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText('último escaneo 13 s')).toBeInTheDocument();
    },
  );
});
