import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CapacityBulkFill from './CapacityBulkFill';

const mockMutate = vi.fn();

vi.mock('@/hooks/useCapacityMutations', () => ({
  useBulkFillCapacity: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

// Mock AlertDialog from shadcn to use simple implementation
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

describe('CapacityBulkFill', () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it('renders weekday and saturday inputs', () => {
    render(
      <CapacityBulkFill
        operatorId="op-1"
        clientId="client-1"
        month="2026-03"
      />
    );
    expect(screen.getByLabelText(/Lun-Vie/i)).toBeDefined();
    expect(screen.getByLabelText(/Sáb/i)).toBeDefined();
  });

  it('renders Aplicar button', () => {
    render(
      <CapacityBulkFill
        operatorId="op-1"
        clientId="client-1"
        month="2026-03"
      />
    );
    expect(screen.getByRole('button', { name: /Aplicar/i })).toBeDefined();
  });

  it('requires both inputs to be filled before enabling apply', () => {
    render(
      <CapacityBulkFill
        operatorId="op-1"
        clientId="client-1"
        month="2026-03"
      />
    );
    const applyBtn = screen.getByRole('button', { name: /Aplicar/i });
    expect(applyBtn).toHaveProperty('disabled', true);
  });

  it('enables apply when both values are provided', () => {
    render(
      <CapacityBulkFill
        operatorId="op-1"
        clientId="client-1"
        month="2026-03"
      />
    );
    fireEvent.change(screen.getByLabelText(/Lun-Vie/i), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(/Sáb/i), { target: { value: '150' } });
    const applyBtn = screen.getByRole('button', { name: /Aplicar/i });
    expect(applyBtn).toHaveProperty('disabled', false);
  });

  it('calls mutate with correct rows on confirm', async () => {
    render(
      <CapacityBulkFill
        operatorId="op-1"
        clientId="client-1"
        month="2026-03"
      />
    );
    fireEvent.change(screen.getByLabelText(/Lun-Vie/i), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(/Sáb/i), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /Aplicar/i }));

    // Find and click the confirm button in the dialog
    const confirmBtn = screen.getByRole('button', { name: /Confirmar/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
      const args = mockMutate.mock.calls[0][0];
      expect(args.operatorId).toBe('op-1');
      expect(args.clientId).toBe('client-1');
      expect(args.rows.length).toBeGreaterThan(0);
      // Check that weekday rows have capacity 300
      const weekdayRow = args.rows.find((r: { capacity_date: string }) => {
        const d = new Date(r.capacity_date + 'T00:00:00');
        return d.getDay() >= 1 && d.getDay() <= 5;
      });
      expect(weekdayRow?.daily_capacity).toBe(300);
    });
  });
});
