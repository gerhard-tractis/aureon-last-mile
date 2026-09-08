import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderLifecycleTimeline } from './OrderLifecycleTimeline';
import type { AuditEntry } from '@/hooks/useOrderDetail';

/**
 * A real status transition as the DB trigger writes it: action is always
 * `UPDATE_orders`, and the milestone lives in `changes_json`. The old
 * fixtures used invented actions ('RECEPTION', 'DELIVERED') that nothing in
 * the system produces, which is why keyword matching looked like it worked.
 */
function transition(to: string, timestamp: string, from = 'ingresado'): AuditEntry {
  return {
    id: `a-${to}`,
    action: 'UPDATE_orders',
    timestamp,
    changes_json: { before: { status: from }, after: { status: to } },
  };
}

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'a-1',
    action: 'CSV_IMPORT',
    timestamp: '2026-08-11T22:04:00',
    changes_json: null,
    ...overrides,
  };
}

describe('OrderLifecycleTimeline', () => {
  it('renders all six milestone labels', () => {
    render(<OrderLifecycleTimeline auditLogs={[]} />);
    for (const label of ['Importada', 'Recogida', 'Recepción', 'Andén', 'En reparto', 'Entregada']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the matched timestamp beneath the milestone label', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[entry({ id: 'a-1', action: 'CSV_IMPORT', timestamp: '2026-08-11T22:04:00' })]}
      />,
    );
    expect(screen.getByText('11/08 22:04')).toBeInTheDocument();
  });

  it('marks an earlier milestone done once a later one has evidence', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[
          entry({ id: 'a-1', action: 'CSV_IMPORT', timestamp: '2026-08-11T22:04:00' }),
          transition('en_bodega', '2026-08-12T17:40:00', 'verificado'),
        ]}
      />,
    );
    expect(screen.getByTestId('milestone-importada')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('milestone-recepcion')).toHaveAttribute('data-state', 'current');
  });

  it('marks the latest matched milestone as current, not done, when later milestones have no evidence', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[entry({ id: 'a-1', action: 'CSV_IMPORT', timestamp: '2026-08-11T22:04:00' })]}
      />,
    );
    expect(screen.getByTestId('milestone-importada')).toHaveAttribute('data-state', 'current');
  });

  it('marks milestones with no evidence as future and renders no timestamp for them — omit, not a dash', () => {
    render(<OrderLifecycleTimeline auditLogs={[]} />);
    const anden = screen.getByTestId('milestone-anden');
    expect(anden).toHaveAttribute('data-state', 'future');
    // The rule is "omit, never fabricate" — no "—" placeholder anywhere in an
    // unreached milestone.
    expect(anden).not.toHaveTextContent('—');
  });

  it('marks every milestone done, including the last, once Entregada has evidence', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[
          entry({ id: 'a-1', action: 'CSV_IMPORT', timestamp: '2026-08-11T22:04:00' }),
          transition('entregado', '2026-08-13T09:20:00', 'en_ruta'),
        ]}
      />,
    );
    expect(screen.getByTestId('milestone-entregada')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('milestone-importada')).toHaveAttribute('data-state', 'done');
  });

  it('ignores audit log entries with a null timestamp rather than crashing or showing "Invalid Date"', () => {
    render(
      <OrderLifecycleTimeline auditLogs={[entry({ id: 'a-1', action: 'CSV_IMPORT', timestamp: null })]} />,
    );
    expect(screen.getByTestId('milestone-importada')).toHaveAttribute('data-state', 'future');
  });
});

describe('OrderLifecycleTimeline — the importadas bug', () => {
  // Reported from Musan QA: orders sitting at `verificado` still read as
  // "Importada". Milestones were matched against `audit_logs.action`, and the
  // trigger only ever writes INSERT_orders / UPDATE_orders / DELETE_orders —
  // so 'insert_orders' hit Importada and nothing else could ever match.
  it('advances a verified order past Importada to Recogida', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[
          entry({ id: 'a-1', action: 'INSERT_orders', timestamp: '2026-09-07T15:13:48' }),
          transition('verificado', '2026-09-07T17:11:58'),
        ]}
      />,
    );
    expect(screen.getByTestId('milestone-importada')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('milestone-recogida')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('07/09 17:11')).toBeInTheDocument();
  });

  it('does not strand an order at Importada just because every action reads UPDATE_orders', () => {
    render(
      <OrderLifecycleTimeline
        auditLogs={[
          entry({ id: 'a-1', action: 'INSERT_orders', timestamp: '2026-09-07T15:13:48' }),
          transition('verificado', '2026-09-07T17:11:58'),
          transition('en_bodega', '2026-09-07T17:43:03', 'verificado'),
        ]}
      />,
    );
    expect(screen.getByTestId('milestone-recogida')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('milestone-recepcion')).toHaveAttribute('data-state', 'current');
  });
});
