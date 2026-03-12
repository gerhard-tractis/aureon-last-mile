import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('shows scanned / total text', () => {
    render(<ProgressBar scanned={5} total={10} />);
    expect(screen.getByText('5 / 10 packages')).toBeInTheDocument();
  });

  it('shows percentage', () => {
    render(<ProgressBar scanned={5} total={10} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('has progressbar role', () => {
    render(<ProgressBar scanned={3} total={10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('shows red when under 50%', () => {
    render(<ProgressBar scanned={2} total={10} />);
    expect(screen.getByRole('progressbar').className).toContain('bg-red-500');
  });

  it('shows yellow between 50-89%', () => {
    render(<ProgressBar scanned={7} total={10} />);
    expect(screen.getByRole('progressbar').className).toContain(
      'bg-yellow-500'
    );
  });

  it('shows green at 90%+', () => {
    render(<ProgressBar scanned={9} total={10} />);
    expect(screen.getByRole('progressbar').className).toContain(
      'bg-green-500'
    );
  });

  it('handles zero total gracefully', () => {
    render(<ProgressBar scanned={0} total={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
