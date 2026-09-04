import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchTabletRate } from './DispatchTabletRate';

afterEach(() => {
  vi.useRealTimers();
});

describe('DispatchTabletRate', () => {
  it('renders nothing with no first scan yet', () => {
    const { container } = render(<DispatchTabletRate packagesLoaded={0} firstScanAtIso={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before enough time has elapsed to make a rate meaningful', () => {
    const nowIso = new Date().toISOString();
    render(<DispatchTabletRate packagesLoaded={2} firstScanAtIso={nowIso} />);
    expect(screen.queryByText(/ritmo/)).not.toBeInTheDocument();
  });

  it('renders packages-per-hour once enough time has elapsed, derived from real history timestamps', () => {
    const firstScanAtIso = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    render(<DispatchTabletRate packagesLoaded={20} firstScanAtIso={firstScanAtIso} />);
    // 20 packages / 10 min * 60 = 120/h
    expect(screen.getByText('· ritmo 120/h')).toBeInTheDocument();
  });
});
