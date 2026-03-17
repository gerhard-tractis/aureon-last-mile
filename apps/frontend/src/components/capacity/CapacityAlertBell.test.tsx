import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const mockAlerts = vi.fn(() => ({ data: [], isLoading: false }));

vi.mock('@/hooks/useCapacityAlerts', () => ({
  useCapacityAlerts: (...args: unknown[]) => mockAlerts(...args),
}));

// CapacityAlertPanel is rendered by the bell — mock it simply
vi.mock('./CapacityAlertPanel', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="alert-panel">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import CapacityAlertBell from './CapacityAlertBell';

describe('CapacityAlertBell', () => {
  beforeEach(() => {
    mockAlerts.mockReturnValue({ data: [], isLoading: false });
  });

  it('renders a bell button', () => {
    render(<CapacityAlertBell operatorId="op-1" />);
    expect(screen.getByRole('button', { name: /alertas de capacidad/i })).toBeDefined();
  });

  it('does not show badge when there are no alerts', () => {
    mockAlerts.mockReturnValue({ data: [], isLoading: false });
    render(<CapacityAlertBell operatorId="op-1" />);
    expect(screen.queryByTestId('alert-badge')).toBeNull();
  });

  it('shows badge with count when alerts exist', () => {
    mockAlerts.mockReturnValue({
      data: [
        { id: '1', utilization_pct: 85, alert_date: '2026-03-01', client_id: 'c1', dismissed_at: null },
        { id: '2', utilization_pct: 100, alert_date: '2026-03-02', client_id: 'c2', dismissed_at: null },
      ],
      isLoading: false,
    });
    render(<CapacityAlertBell operatorId="op-1" />);
    const badge = screen.getByTestId('alert-badge');
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe('2');
  });

  it('shows 99+ when alert count exceeds 99', () => {
    const manyAlerts = Array.from({ length: 105 }, (_, i) => ({
      id: String(i),
      utilization_pct: 80,
      alert_date: '2026-03-01',
      client_id: 'c1',
      dismissed_at: null,
    }));
    mockAlerts.mockReturnValue({ data: manyAlerts, isLoading: false });
    render(<CapacityAlertBell operatorId="op-1" />);
    const badge = screen.getByTestId('alert-badge');
    expect(badge.textContent).toBe('99+');
  });

  it('opens panel on bell click', () => {
    mockAlerts.mockReturnValue({ data: [{ id: '1' }], isLoading: false });
    render(<CapacityAlertBell operatorId="op-1" />);
    expect(screen.queryByTestId('alert-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /alertas de capacidad/i }));
    expect(screen.getByTestId('alert-panel')).toBeDefined();
  });

  it('closes panel when onClose callback is invoked', () => {
    mockAlerts.mockReturnValue({ data: [{ id: '1' }], isLoading: false });
    render(<CapacityAlertBell operatorId="op-1" />);
    fireEvent.click(screen.getByRole('button', { name: /alertas de capacidad/i }));
    expect(screen.getByTestId('alert-panel')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('alert-panel')).toBeNull();
  });

  it('toggles panel closed when bell clicked again', () => {
    mockAlerts.mockReturnValue({ data: [{ id: '1' }], isLoading: false });
    render(<CapacityAlertBell operatorId="op-1" />);
    const btn = screen.getByRole('button', { name: /alertas de capacidad/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('alert-panel')).toBeDefined();
    fireEvent.click(btn);
    expect(screen.queryByTestId('alert-panel')).toBeNull();
  });

  it('passes operatorId to useCapacityAlerts', () => {
    render(<CapacityAlertBell operatorId="op-xyz" />);
    expect(mockAlerts).toHaveBeenCalledWith('op-xyz');
  });
});
