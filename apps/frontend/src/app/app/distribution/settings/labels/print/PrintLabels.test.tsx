import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintLabels } from './PrintLabels';

vi.mock('bwip-js/browser', () => ({
  default: {
    toSVG: () => '<svg data-testid="bwipjs-svg"></svg>',
  },
}));

describe('PrintLabels', () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printSpy = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, writable: true, value: printSpy });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function flushFrames() {
    // PrintLabels schedules window.print() inside two requestAnimationFrame ticks
    // wrapped in a setTimeout to give the browser time to paint the SVGs.
    vi.advanceTimersByTime(120);
  }

  it('renders one label section per zone inside the print root', () => {
    const zones = [
      { id: 'z1', code: 'DOCK-001', name: 'Santiago Oriente' },
      { id: 'z2', code: 'DOCK-002', name: 'Santiago Sur' },
    ];
    const { container } = render(<PrintLabels zones={zones} />);
    const root = container.querySelector('.dock-label-print-root');
    expect(root).not.toBeNull();
    expect(root!.querySelectorAll('.dock-label')).toHaveLength(2);
    expect(screen.getByText('Santiago Oriente')).toBeInTheDocument();
    expect(screen.getByText('Santiago Sur')).toBeInTheDocument();
  });

  it('calls window.print() once on mount', () => {
    const zones = [{ id: 'z1', code: 'DOCK-001', name: 'Santiago Oriente' }];
    render(<PrintLabels zones={zones} />);
    flushFrames();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a fallback message and skips printing when zones is empty', () => {
    render(<PrintLabels zones={[]} />);
    flushFrames();
    expect(screen.getByText(/no hay andenes para imprimir/i)).toBeInTheDocument();
    expect(printSpy).not.toHaveBeenCalled();
  });
});
