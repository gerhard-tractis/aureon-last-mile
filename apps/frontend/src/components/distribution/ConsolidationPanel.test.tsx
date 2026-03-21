import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsolidationPanel } from './ConsolidationPanel';

const packages = [
  { id: 'p1', label: 'PKG-001', dock_zone_id: 'z1', order_id: 'o1', delivery_date: '2026-03-19' },
  { id: 'p2', label: 'PKG-002', dock_zone_id: 'z1', order_id: 'o2', delivery_date: '2026-03-25' },
];

describe('ConsolidationPanel', () => {
  it('renders packages with their labels', () => {
    render(<ConsolidationPanel packages={packages} onRelease={vi.fn()} />);
    expect(screen.getByText('PKG-001')).toBeInTheDocument();
    expect(screen.getByText('PKG-002')).toBeInTheDocument();
  });

  it('calls onRelease with selected package id when Liberar is clicked', () => {
    const onRelease = vi.fn();
    render(<ConsolidationPanel packages={packages} onRelease={onRelease} />);
    const releaseButtons = screen.getAllByRole('button', { name: /liberar/i });
    fireEvent.click(releaseButtons[0]);
    expect(onRelease).toHaveBeenCalledWith(['p1']);
  });

  it('shows empty state when no packages in consolidation', () => {
    render(<ConsolidationPanel packages={[]} onRelease={vi.fn()} />);
    expect(screen.getByText(/no hay paquetes/i)).toBeInTheDocument();
  });

  it('renders a Liberar button per package', () => {
    render(<ConsolidationPanel packages={packages} onRelease={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /liberar/i });
    expect(buttons).toHaveLength(2);
  });
});
