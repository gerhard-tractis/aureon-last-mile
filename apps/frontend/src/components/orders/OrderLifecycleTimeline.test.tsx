import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderLifecycleTimeline } from './OrderLifecycleTimeline';
import type { AuditEntry } from '@/hooks/useOrderDetail';

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
          entry({ id: 'a-2', action: 'RECEPTION', timestamp: '2026-08-12T17:40:00' }),
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
          entry({ id: 'a-2', action: 'DELIVERED', timestamp: '2026-08-13T09:20:00' }),
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
