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

  it('applies a neutral tone under 90% fill', () => {
    render(<DockCapacityBar count={50} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toMatch(/map-line|accent/);
    expect(bar.className).not.toMatch(/status-warning|status-error/);
  });

  it('applies a warning tone at 90% fill or above', () => {
    render(<DockCapacityBar count={90} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toMatch(/status-warning/);
  });

  it('applies an error tone at 100% fill or above', () => {
    render(<DockCapacityBar count={100} capacity={100} />);
    const bar = screen.getByTestId('dock-capacity-fill');
    expect(bar.className).toMatch(/status-error/);
  });

  it('never uses raw hex colours', () => {
    const { container } = render(<DockCapacityBar count={100} capacity={100} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
