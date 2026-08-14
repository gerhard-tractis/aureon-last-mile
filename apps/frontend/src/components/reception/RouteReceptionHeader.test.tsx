import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteReceptionHeader } from './RouteReceptionHeader';

const baseProps = {
  code: 'PR-2026-0001',
  driverName: 'Ana Ruiz',
  plate: 'AAA-111',
  manifestCount: 2,
  expectedCount: 15,
  receivedCount: 5,
  unexpectedCount: 0,
};

describe('RouteReceptionHeader', () => {
  it('renders route code, driver, plate and counts', () => {
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

  // ---------------------------------------------------------------------
  // spec-52: expected_count and received_count now count DIFFERENT
  // populations, so the headline fraction must be matched/expected —
  // received minus the packages that arrived without a pickup scan.
  // ---------------------------------------------------------------------
  it('shows the fraction as matched/expected, not received/expected', () => {
    render(
      <RouteReceptionHeader
        {...baseProps}
        expectedCount={10}
        receivedCount={9}
        unexpectedCount={1}
      />,
    );
    // 9 received of which 1 was unexpected => 8 of the 10 expected arrived.
    expect(screen.getByTestId('reception-counts').textContent).toMatch(
      /8\s*\/\s*10/,
    );
    expect(screen.getByTestId('reception-counts').textContent).not.toMatch(
      /9\s*\/\s*10/,
    );
  });

  it('calls out the unexpected set separately when unexpected_count > 0', () => {
    render(
      <RouteReceptionHeader
        {...baseProps}
        expectedCount={10}
        receivedCount={9}
        unexpectedCount={1}
      />,
    );
    expect(screen.getByTestId('unexpected-count')).toHaveTextContent(
      '1 inesperado',
    );
  });

  it('pluralises the unexpected callout', () => {
    render(
      <RouteReceptionHeader
        {...baseProps}
        expectedCount={10}
        receivedCount={12}
        unexpectedCount={3}
      />,
    );
    expect(screen.getByTestId('unexpected-count')).toHaveTextContent(
      '3 inesperados',
    );
  });

  it('renders NO unexpected callout when unexpected_count is zero', () => {
    render(<RouteReceptionHeader {...baseProps} unexpectedCount={0} />);
    expect(screen.queryByTestId('unexpected-count')).not.toBeInTheDocument();
    expect(screen.queryByText(/inesperado/i)).not.toBeInTheDocument();
  });

  it('bases the progressbar on matched packages, not raw received', () => {
    render(
      <RouteReceptionHeader
        {...baseProps}
        expectedCount={10}
        receivedCount={10}
        unexpectedCount={1}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('9');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
  });
});
