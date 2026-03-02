import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import MetricsCard, { getMetricColor, getMetricHexColor } from './MetricsCard';

// Mock recharts to avoid rendering issues in jsdom
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'area-chart' }, children),
  Area: () => React.createElement('div', { 'data-testid': 'area' }),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, children),
}));

describe('getMetricColor', () => {
  it('returns green for higher-better above green threshold', () => {
    expect(getMetricColor(96, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('text-[#10b981]');
  });

  it('returns yellow for higher-better between thresholds', () => {
    expect(getMetricColor(92, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('text-[#f59e0b]');
  });

  it('returns red for higher-better below yellow', () => {
    expect(getMetricColor(85, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('text-[#ef4444]');
  });

  it('returns green for lower-better below green threshold', () => {
    expect(getMetricColor(35, { green: 40, yellow: 60, direction: 'lower-better' })).toBe('text-[#10b981]');
  });

  it('returns yellow for lower-better between thresholds', () => {
    expect(getMetricColor(50, { green: 40, yellow: 60, direction: 'lower-better' })).toBe('text-[#f59e0b]');
  });

  it('returns red for lower-better above yellow', () => {
    expect(getMetricColor(70, { green: 40, yellow: 60, direction: 'lower-better' })).toBe('text-[#ef4444]');
  });

  it('returns slate for null', () => {
    expect(getMetricColor(null, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('text-slate-400');
  });

  it('returns slate for NaN', () => {
    expect(getMetricColor(NaN, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('text-slate-400');
  });
});

describe('getMetricHexColor', () => {
  it('returns hex green for values above green threshold', () => {
    expect(getMetricHexColor(96, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('#10b981');
  });

  it('returns hex slate for null', () => {
    expect(getMetricHexColor(null, { green: 95, yellow: 90, direction: 'higher-better' })).toBe('#94a3b8');
  });
});

describe('MetricsCard', () => {
  const defaultProps = {
    title: 'FADR',
    icon: '🎯',
    value: '92.1%',
    color: 'text-[#f59e0b]',
    context: '281/305 primera entrega exitosa',
    ariaLabel: 'FADR: 92.1%',
  };

  it('renders title, icon, and value', () => {
    render(<MetricsCard {...defaultProps} />);
    expect(screen.getByText('FADR')).toBeInTheDocument();
    expect(screen.getByText('🎯')).toBeInTheDocument();
    expect(screen.getByText('92.1%')).toBeInTheDocument();
  });

  it('renders context line', () => {
    render(<MetricsCard {...defaultProps} />);
    expect(screen.getByText('281/305 primera entrega exitosa')).toBeInTheDocument();
  });

  it('renders trend when provided', () => {
    render(<MetricsCard {...defaultProps} trend="↑ +2.3% vs semana anterior" trendUp={true} />);
    expect(screen.getByText('↑ +2.3% vs semana anterior')).toBeInTheDocument();
  });

  it('renders benchmark badge when provided', () => {
    render(<MetricsCard {...defaultProps} benchmarkBadge="⭐ Excelente (>95%)" />);
    expect(screen.getByText('⭐ Excelente (>95%)')).toBeInTheDocument();
  });

  it('renders ROI line when provided', () => {
    render(<MetricsCard {...defaultProps} roiLine="💾 Ahorro: $150,000 CLP este mes" />);
    expect(screen.getByText('💾 Ahorro: $150,000 CLP este mes')).toBeInTheDocument();
  });

  it('renders capacity line when provided', () => {
    render(<MetricsCard {...defaultProps} capacityLine="📊 45% capacidad" />);
    expect(screen.getByText('📊 45% capacidad')).toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    render(<MetricsCard {...defaultProps} />);
    const card = screen.getByRole('button', { name: 'FADR: 92.1%' });
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<MetricsCard {...defaultProps} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('calls onClick on Enter key', async () => {
    const onClick = vi.fn();
    render(<MetricsCard {...defaultProps} onClick={onClick} />);
    const card = screen.getByRole('button');
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('calls onClick on Space key', async () => {
    const onClick = vi.fn();
    render(<MetricsCard {...defaultProps} onClick={onClick} />);
    const card = screen.getByRole('button');
    card.focus();
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows stale indicator when isStale is true', () => {
    render(<MetricsCard {...defaultProps} isStale={true} />);
    expect(screen.getByTitle('Los datos pueden estar desactualizados')).toBeInTheDocument();
  });

  it('renders sparkline when data is provided', () => {
    const sparklineData = [
      { date: '2026-02-24', value: 90 },
      { date: '2026-02-25', value: 92 },
    ];
    render(<MetricsCard {...defaultProps} sparklineData={sparklineData} sparklineColor="#10b981" />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('does not render sparkline when no data', () => {
    render(<MetricsCard {...defaultProps} />);
    expect(screen.queryByTestId('responsive-container')).not.toBeInTheDocument();
  });
});
