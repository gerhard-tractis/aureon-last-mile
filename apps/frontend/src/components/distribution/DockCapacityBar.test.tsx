import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockCapacityBar } from './DockCapacityBar';

describe('DockCapacityBar', () => {
  it('renders nothing when capacity is not configured (null)', () => {
    const { container } = render(<DockCapacityBar count={50} capacity={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when capacity is 0', () => {
    const { container } = render(<DockCapacityBar count={0} capacity={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the fill bar and count/capacity text when configured', () => {
    render(<DockCapacityBar count={169} capacity={180} />);
    expect(screen.getByText(/169/)).toBeInTheDocument();
    expect(screen.getByText(/180/)).toBeInTheDocument();
  });

  it('shows the "quedan N espacios" copy', () => {
    render(<DockCapacityBar count={169} capacity={180} />);
    expect(screen.getByText('Quedan 11 espacios')).toBeInTheDocument();
  });

  it('applies the neutral fill token (bg-text-secondary) under 90% fill', () => {
    // Regression test: bg-map-line on bg-surface-raised in dark mode is
    // 1.59:1, under spec-63's 3:1 non-text floor, and map-line is a map
    // stroke token anyway — not a fill token. bg-accent is also disallowed:
    // the handoff's colour rule reserves gold for brand/selection, never a
    // state readout. Asserted as the exact class, not an alternation, so a
    // regression to either wrong token fails this test.
    render(<DockCapacityBar count={50} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toContain('bg-text-secondary');
    expect(bar.className).not.toMatch(/bg-map-line|bg-accent|status-warning|status-error/);
  });

  it('applies the warning fill token at 90% fill or above', () => {
    render(<DockCapacityBar count={90} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toContain('bg-status-warning');
    expect(bar.className).not.toContain('bg-status-warning-bg');
  });

  it('applies the error fill token at 100% fill or above', () => {
    render(<DockCapacityBar count={100} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toContain('bg-status-error');
    expect(bar.className).not.toContain('bg-status-error-bg');
  });

  it('never uses raw hex colours', () => {
    const { container } = render(<DockCapacityBar count={100} capacity={100} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
