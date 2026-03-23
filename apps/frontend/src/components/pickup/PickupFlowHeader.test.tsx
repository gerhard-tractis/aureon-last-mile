import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupFlowHeader } from './PickupFlowHeader';

describe('PickupFlowHeader', () => {
  it('renders load ID', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={5} total={18} />);
    expect(screen.getByText('CARGA-001')).toBeInTheDocument();
  });

  it('renders progress as "scanned / total"', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={12} total={18} />);
    expect(screen.getByText('12 / 18')).toBeInTheDocument();
  });

  it('renders a progress bar element', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={9} total={18} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sets progress bar width to 50% when scanned is half of total', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={9} total={18} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '50%' });
  });

  it('clamps progress bar to 100% when scanned exceeds total', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={20} total={18} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '100%' });
  });

  it('renders 0% progress when total is 0', () => {
    render(<PickupFlowHeader loadId="CARGA-001" scanned={0} total={0} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveStyle({ width: '0%' });
  });
});
