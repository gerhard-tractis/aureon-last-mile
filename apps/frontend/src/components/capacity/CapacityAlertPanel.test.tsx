import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockDismiss = vi.fn();
const mockMutate = vi.fn();

vi.mock('@/hooks/useCapacityAlerts', () => ({
  useDismissAlert: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockNavigate }),
}));

import CapacityAlertPanel from './CapacityAlertPanel';

const baseAlert = {
  id: 'alert-1',
  operator_id: 'op-1',
  client_id: 'client-abc',
  alert_date: '2026-03-15',
  threshold_pct: 80,
  actual_orders: 85,
  daily_capacity: 100,
  utilization_pct: 85,
  dismissed_at: null,
  deleted_at: null,
  created_at: '2026-03-15T10:00:00Z',
};

describe('CapacityAlertPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    mockMutate.mockClear();
    mockNavigate.mockClear();
    onClose.mockClear();
  });

  it('shows "No hay alertas activas" when alerts list is empty', () => {
    render(<CapacityAlertPanel alerts={[]} onClose={onClose} />);
    expect(screen.getByText(/no hay alertas activas/i)).toBeDefined();
  });

  it('renders alert rows', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    expect(screen.getByText(/client-abc/i)).toBeDefined();
    expect(screen.getByText(/85%/)).toBeDefined();
  });

  it('shows formatted date DD/MM', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    // 2026-03-15 → 15/03 (may be combined with utilization text in same element)
    expect(screen.getByText(/15\/03/)).toBeDefined();
  });

  it('renders "Ver" and "Descartar" buttons for each alert', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /ver/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /descartar/i })).toBeDefined();
  });

  it('"Ver" button navigates to capacity-planning', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /ver/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/capacity-planning');
  });

  it('"Descartar" button calls useDismissAlert mutate with alert id', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(mockMutate).toHaveBeenCalledWith('alert-1');
  });

  it('shows maximum 10 alerts', () => {
    const manyAlerts = Array.from({ length: 15 }, (_, i) => ({
      ...baseAlert,
      id: `alert-${i}`,
      client_id: `client-${i}`,
    }));
    render(<CapacityAlertPanel alerts={manyAlerts} onClose={onClose} />);
    const descartarBtns = screen.getAllByRole('button', { name: /descartar/i });
    expect(descartarBtns.length).toBe(10);
  });

  it('shows yellow severity indicator for 80% threshold alerts', () => {
    const alert80 = { ...baseAlert, threshold_pct: 80, utilization_pct: 82 };
    render(<CapacityAlertPanel alerts={[alert80]} onClose={onClose} />);
    const indicator = document.querySelector('[data-testid="severity-indicator"]');
    expect(indicator).toBeDefined();
    expect(indicator?.className).toContain('yellow');
  });

  it('shows orange severity indicator for 100% threshold alerts', () => {
    const alert100 = { ...baseAlert, threshold_pct: 100, utilization_pct: 105 };
    render(<CapacityAlertPanel alerts={[alert100]} onClose={onClose} />);
    const indicator = document.querySelector('[data-testid="severity-indicator"]');
    expect(indicator?.className).toContain('orange');
  });

  it('shows red severity indicator for 120% threshold alerts', () => {
    const alert120 = { ...baseAlert, threshold_pct: 120, utilization_pct: 125 };
    render(<CapacityAlertPanel alerts={[alert120]} onClose={onClose} />);
    const indicator = document.querySelector('[data-testid="severity-indicator"]');
    expect(indicator?.className).toContain('red');
  });

  it('uses client_id as fallback label', () => {
    render(<CapacityAlertPanel alerts={[baseAlert]} onClose={onClose} />);
    expect(screen.getByText(/client-abc/)).toBeDefined();
  });
});
