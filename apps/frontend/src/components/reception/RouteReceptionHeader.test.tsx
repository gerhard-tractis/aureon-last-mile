import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteReceptionHeader } from './RouteReceptionHeader';

const baseProps = {
  code: 'PR-2026-0001',
  driverName: 'Ana Ruiz',
  vehicleLabel: 'AAA-111',
  manifestCount: 2,
  expectedCount: 15,
  receivedCount: 5,
};

describe('RouteReceptionHeader', () => {
  it('renders route code, driver, vehicle and counts', () => {
    render(<RouteReceptionHeader {...baseProps} />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/Ana Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/AAA-111/)).toBeInTheDocument();
    expect(screen.getByText(/2 manifiestos/)).toBeInTheDocument();
    expect(screen.getByText(/15 paquetes esperados/)).toBeInTheDocument();
  });

  it('renders accessible progressbar with correct aria values', () => {
    render(<RouteReceptionHeader {...baseProps} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuemax')).toBe('15');
  });

  it('caps the progress bar at 100% when received exceeds expected', () => {
    const { container } = render(
      <RouteReceptionHeader {...baseProps} receivedCount={20} />,
    );
    const fill = container.querySelector('.bg-accent') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });
});
