import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the correct label for delivered status', () => {
    render(<StatusBadge status="delivered" />);
    expect(screen.getByText('Entregado')).toBeInTheDocument();
  });

  it('renders the correct label for in_transit status', () => {
    render(<StatusBadge status="in_transit" />);
    expect(screen.getByText('En Ruta')).toBeInTheDocument();
  });

  it('renders the correct label for failed status', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText('Fallido')).toBeInTheDocument();
  });

  it('renders the correct label for picked_up status', () => {
    render(<StatusBadge status="picked_up" />);
    expect(screen.getByText('Recogido')).toBeInTheDocument();
  });

  it('renders the correct label for pending status', () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('renders the correct label for returned status', () => {
    render(<StatusBadge status="returned" />);
    expect(screen.getByText('Devuelto')).toBeInTheDocument();
  });

  it('applies success variant classes for delivered', () => {
    const { container } = render(<StatusBadge status="delivered" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-success-bg');
    expect(badge.className).toContain('text-status-success');
  });

  it('applies error variant classes for failed', () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-error-bg');
    expect(badge.className).toContain('text-status-error');
  });

  it('allows custom variant override', () => {
    const { container } = render(<StatusBadge status="pending" variant="warning" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-status-warning-bg');
  });

  it('renders sm size with smaller text', () => {
    const { container } = render(<StatusBadge status="delivered" size="sm" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('text-[10px]');
  });

  it('renders unknown status with neutral styling', () => {
    render(<StatusBadge status="some_custom_status" />);
    expect(screen.getByText('some_custom_status')).toBeInTheDocument();
  });
});
