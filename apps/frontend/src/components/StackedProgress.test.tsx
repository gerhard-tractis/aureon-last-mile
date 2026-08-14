import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StackedProgress } from './StackedProgress';

const SEGMENTS = [
  { key: 'delivered', label: 'Entregadas', value: 823, tone: 'success' as const },
  { key: 'en_route', label: 'En ruta', value: 261, tone: 'accent' as const },
  { key: 'at_risk', label: 'En riesgo', value: 117, tone: 'warning' as const },
  { key: 'late', label: 'Atrasadas', value: 83, tone: 'error' as const },
];

describe('StackedProgress', () => {
  it('sizes each segment as its share of the total', () => {
    render(<StackedProgress segments={SEGMENTS} />);
    // 823 of 1284 = 64.1%
    expect(screen.getByTestId('segment-delivered').style.width).toMatch(/^64\.[0-9]+%$/);
    expect(screen.getByTestId('segment-late').style.width).toMatch(/^6\.[0-9]+%$/);
  });

  it('renders a legend with counts when asked', () => {
    render(<StackedProgress segments={SEGMENTS} showLegend />);
    expect(screen.getByText('Entregadas 823')).toBeInTheDocument();
    expect(screen.getByText('Atrasadas 83')).toBeInTheDocument();
  });

  it('omits the legend by default', () => {
    render(<StackedProgress segments={SEGMENTS} />);
    expect(screen.queryByText('Entregadas 823')).toBeNull();
  });

  it('drops zero-value segments so they cannot render as hairlines', () => {
    render(<StackedProgress segments={[...SEGMENTS, { key: 'z', label: 'Nada', value: 0, tone: 'error' as const }]} />);
    expect(screen.queryByTestId('segment-z')).toBeNull();
  });

  it('renders nothing but the empty track when every value is zero', () => {
    // Guards the 0/0 division — a bar of NaN-width segments renders as garbage.
    render(<StackedProgress segments={[{ key: 'a', label: 'A', value: 0, tone: 'success' }]} />);
    expect(screen.queryByTestId('segment-a')).toBeNull();
    expect(screen.getByRole('img', { name: /progreso/i })).toBeInTheDocument();
  });

  it('exposes an accessible summary of the breakdown', () => {
    render(<StackedProgress segments={SEGMENTS} ariaLabel="Progreso de la promesa del día" />);
    const bar = screen.getByRole('img', { name: 'Progreso de la promesa del día' });
    expect(bar.getAttribute('title')).toContain('Entregadas 823');
  });
});
