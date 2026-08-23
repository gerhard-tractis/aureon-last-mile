import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FichaCenterColumn } from './FichaCenterColumn';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

const mockUnifiedEventLog = vi.fn();
vi.mock('@/components/orders/UnifiedEventLog', () => ({
  UnifiedEventLog: (props: { auditLogs: unknown[]; dispatches: unknown[] }) => {
    mockUnifiedEventLog(props);
    return (
      <div data-testid="unified-event-log">
        audit:{props.auditLogs.length} dispatch:{props.dispatches.length}
      </div>
    );
  },
}));

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-08-13T12:00:00', changes_json: null, ...overrides };
}

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'd-1',
    substatus: null,
    substatus_code: null,
    status: 'en_ruta',
    completed_at: null,
    arrived_at: null,
    estimated_at: null,
    failure_reason: null,
    latitude: null,
    longitude: null,
    raw_data: {},
    is_pickup: false,
    external_route_id: null,
    driver_name: null,
    route_id: null,
    ...overrides,
  };
}

describe('FichaCenterColumn', () => {
  it('shows the total event count across both sources, unaffected by the active filter', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry(), auditEntry({ id: 'a-2' })]} dispatches={[dispatch()]} />);
    expect(screen.getByText(/3 eventos/)).toBeInTheDocument();
  });

  it('passes every event through to UnifiedEventLog under the default "Todo" filter', () => {
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('audit:1 dispatch:1');
  });

  it('filters out DispatchTrack events when "Aureon" is selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'Aureon' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('audit:1 dispatch:0');
  });

  it('filters out Aureon events when "DispatchTrack" is selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'DispatchTrack' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('audit:0 dispatch:1');
  });

  it('returns to showing every event when "Todo" is re-selected', async () => {
    const user = userEvent.setup();
    render(<FichaCenterColumn auditLogs={[auditEntry()]} dispatches={[dispatch()]} />);
    await user.click(screen.getByRole('button', { name: 'DispatchTrack' }));
    await user.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByTestId('unified-event-log')).toHaveTextContent('audit:1 dispatch:1');
  });
});
