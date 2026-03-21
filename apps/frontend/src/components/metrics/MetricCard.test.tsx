import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './MetricCard';
import { Package } from 'lucide-react';

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Pedidos Hoy" value="1,247" />);
    expect(screen.getByText('Pedidos Hoy')).toBeInTheDocument();
    expect(screen.getByText('1,247')).toBeInTheDocument();
  });

  it('renders numeric value', () => {
    render(<MetricCard label="Count" value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders trend with up direction', () => {
    render(<MetricCard label="SLA" value="94%" trend={{ direction: 'up', value: '+1.3%', favorable: true }} />);
    expect(screen.getByText('+1.3%')).toBeInTheDocument();
  });

  it('applies favorable color to up trend', () => {
    const { container } = render(
      <MetricCard label="SLA" value="94%" trend={{ direction: 'up', value: '+1.3%', favorable: true }} />
    );
    const trendEl = container.querySelector('[data-trend]');
    expect(trendEl?.className).toContain('text-status-success');
  });

  it('applies unfavorable color to up trend (higher is worse)', () => {
    const { container } = render(
      <MetricCard label="Fallidos" value="23" trend={{ direction: 'up', value: '+5', favorable: false }} />
    );
    const trendEl = container.querySelector('[data-trend]');
    expect(trendEl?.className).toContain('text-status-error');
  });

  it('renders icon when provided', () => {
    render(<MetricCard label="Test" value="1" icon={Package} />);
    // lucide icons render as SVGs
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders sparkline data as SVG when provided', () => {
    render(<MetricCard label="Trend" value="100" sparklineData={[10, 20, 30, 40, 50]} />);
    const svg = document.querySelector('svg.sparkline');
    expect(svg).not.toBeNull();
  });

  it('value uses monospace font', () => {
    const { container } = render(<MetricCard label="X" value="99" />);
    const valueEl = container.querySelector('[data-value]');
    expect(valueEl?.className).toContain('font-mono');
  });
});
