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
      buildRejectedEntry({ id: '1', code: 'CL1', atIso: 't', failure: { code: 'NOT_FOUND', message: 'x' } }),
    ];
    render(<DispatchScanHistoryList entries={entries} />);
    const row = screen.getByTestId('dispatch-scan-history-row');
    expect(row).not.toHaveAttribute('role', 'button');
    expect(row.querySelector('button')).toBeNull();
  });
});
