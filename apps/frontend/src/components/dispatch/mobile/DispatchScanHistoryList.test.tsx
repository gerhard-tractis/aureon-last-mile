import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchScanHistoryList } from './DispatchScanHistoryList';
import { buildAcceptedEntry, buildRejectedEntry } from '@/lib/dispatch/mobile/scan-session';

describe('DispatchScanHistoryList', () => {
  it('shows the empty-session hint before any scan', () => {
    render(<DispatchScanHistoryList entries={[]} />);
    expect(screen.getByText(/aparecen aquí/i)).toBeInTheDocument();
  });

  it('spec-76 2e/2f — accepted and rejected scans render in the SAME list, newest-first order preserved as given', () => {
    const entries = [
      // 'RUT-0087' is a readable fixture — routeCode() (crew-board.ts)
      // really emits an 8-char UUID slice, e.g. "ABCDEF12" (see
      // scan-rejection-copy.test.ts's own note).
      buildRejectedEntry({
        id: '2',
        code: 'CL9999',
        atIso: '2026-09-03T12:20:00.000Z',
        failure: { code: 'ALREADY_IN_ROUTE', message: 'x', conflictingRouteId: 'route-2' },
        conflictingRouteCode: 'RUT-0087',
      }),
      buildAcceptedEntry({
        id: '1',
        code: 'CL8841873',
        atIso: '2026-09-03T12:19:04.000Z',
        response: { order_id: 'o1', order_number: 'ORD-3311', contact_name: null, contact_address: null },
        orderContext: { comuna: 'Ñuñoa', retailerName: null, stopIndex: null },
      }),
    ];
    render(<DispatchScanHistoryList entries={entries} />);
    const rows = screen.getAllByTestId('dispatch-scan-history-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('CL9999');
    expect(rows[0]).toHaveTextContent('YA EN RUT-0087');
    expect(rows[1]).toHaveTextContent('CL8841873');
    expect(rows[1]).toHaveTextContent('ORD-3311');
    expect(rows[1]).toHaveTextContent('Ñuñoa');
  });

  it('a rejection row is not a nested interactive control — no button/role inside the row (Lecciones aplicadas #4)', () => {
    const entries = [
      buildRejectedEntry({ id: '1', code: 'CL1', atIso: '2026-09-03T09:00:00.000Z', failure: { code: 'NOT_FOUND', message: 'x' } }),
    ];
    render(<DispatchScanHistoryList entries={entries} />);
    const row = screen.getByTestId('dispatch-scan-history-row');
    expect(row).not.toHaveAttribute('role', 'button');
    expect(row.querySelector('button')).toBeNull();
  });

  it('spec-76 review "spec deviations" — renders at most the 20 most recent rows, "ÚLTIMAS" not the full shift', () => {
    const entries = Array.from({ length: 45 }, (_, i) =>
      buildAcceptedEntry({
        id: `e${i}`,
        code: `CODE-${i}`,
        atIso: `2026-09-03T09:${String(i).padStart(2, '0')}:00.000Z`,
        response: { order_id: 'o1', order_number: 'n', contact_name: null, contact_address: null },
      }),
    ).reverse(); // newest-first, matching how the hook accumulates it
    render(<DispatchScanHistoryList entries={entries} />);
    const rows = screen.getAllByTestId('dispatch-scan-history-row');
    expect(rows).toHaveLength(20);
    // The rendered rows are the 20 NEWEST (entries[0..19]), not the oldest.
    expect(rows[0]).toHaveTextContent('CODE-44');
    expect(rows[19]).toHaveTextContent('CODE-25');
  });
});
