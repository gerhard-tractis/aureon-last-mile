import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnifiedEventLog } from './UnifiedEventLog';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit-1',
    action: 'CSV_IMPORT',
    timestamp: '2026-08-12T17:40:00',
    changes_json: { rows_imported: 3 },
    ...overrides,
  };
}

function dispatchRow(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'dp-1',
    substatus: 'Recibido por cliente',
    substatus_code: '00',
    status: 'delivered',
    completed_at: '2026-08-13T12:41:08',
    arrived_at: null,
    estimated_at: null,
    failure_reason: null,
    latitude: null,
    longitude: null,
    raw_data: { attempt: 1, accuracy_m: 42 },
    is_pickup: false,
    external_route_id: null,
    driver_name: null,
    route_id: null,
    ...overrides,
  };
}

describe('UnifiedEventLog — empty states', () => {
  it('says plainly there are no courier events when there are no dispatches, even with audit entries present', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[]} />);
    expect(screen.getByText(/Sin eventos de courier registrados/)).toBeInTheDocument();
    // The audit entry itself must still show — the empty state doesn't hide it.
    expect(screen.getByText('AUREON')).toBeInTheDocument();
  });

  it('shows a full-log empty state when there are neither audit entries nor dispatches', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[]} />);
    expect(screen.getByText(/Sin eventos registrados/)).toBeInTheDocument();
  });

  it('shows no courier-empty message once a dispatch is present', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} />);
    expect(screen.queryByText(/Sin eventos de courier registrados/)).not.toBeInTheDocument();
  });
});

describe('UnifiedEventLog — merging and ordering', () => {
  it('merges AUREON and DISPATCHTRACK entries sorted by timestamp, most recent first', () => {
    render(
      <UnifiedEventLog
        auditLogs={[auditEntry({ id: 'a-1', timestamp: '2026-08-12T17:40:00' })]}
        dispatches={[dispatchRow({ id: 'dp-1', completed_at: '2026-08-13T12:41:08' })]}
      />,
    );
    const badges = screen.getAllByText(/AUREON|DISPATCHTRACK/);
    expect(badges[0]).toHaveTextContent('DISPATCHTRACK');
    expect(badges[1]).toHaveTextContent('AUREON');
  });

  it('labels each entry with its source badge', () => {
    render(
      <UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} />,
    );
    expect(screen.getByText('AUREON')).toBeInTheDocument();
    expect(screen.getByText('DISPATCHTRACK')).toBeInTheDocument();
  });
});

describe('UnifiedEventLog — expansion', () => {
  it('keeps the technical data collapsed by default', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} />);
    expect(screen.queryByText(/"attempt": ?1|"attempt":1/)).not.toBeInTheDocument();
  });

  it('expanding a DispatchTrack entry shows the decoder four-field grid', async () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} />);
    await userEvent.click(screen.getByTestId('event-toggle-dp-1'));
    expect(screen.getByText('MOTIVO')).toBeInTheDocument();
    expect(screen.getAllByText('Recibido por cliente').length).toBeGreaterThan(0);
    expect(screen.getByText('INTENTO')).toBeInTheDocument();
    expect(screen.getByText('UBICACIÓN')).toBeInTheDocument();
    expect(screen.getByText('a 42 m de la dirección')).toBeInTheDocument();
    expect(screen.getByText('RESPALDO')).toBeInTheDocument();
  });

  it('reveals the raw JSON only after "Ver datos técnicos" is clicked', async () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} />);
    await userEvent.click(screen.getByTestId('event-toggle-dp-1'));
    expect(screen.queryByText(/"attempt"/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Ver datos técnicos'));
    expect(screen.getByText(/"attempt"/)).toBeInTheDocument();
  });

  it('omits the INTENTO field entirely when raw_data has no attempt — not a dash', async () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow({ raw_data: {} })]} />);
    await userEvent.click(screen.getByTestId('event-toggle-dp-1'));
    expect(screen.queryByText('INTENTO')).not.toBeInTheDocument();
  });

  // Review round 1 — an audit entry's toggle rendered but did nothing: the
  // body only ever checked `source === 'dispatchtrack'`. With Fase 1 parked,
  // AUREON entries are the only entries for most orders, so this is the
  // interaction users hit most.
  it('expanding an AUREON entry reveals its changes_json behind "Ver datos técnicos"', async () => {
    render(<UnifiedEventLog auditLogs={[auditEntry({ id: 'audit-9', changes_json: { rows_imported: 7 } })]} dispatches={[]} />);
    await userEvent.click(screen.getByTestId('event-toggle-audit-9'));
    expect(screen.queryByText(/"rows_imported"/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Ver datos técnicos'));
    expect(screen.getByText(/"rows_imported": 7/)).toBeInTheDocument();
  });

  it('marks each toggle with aria-expanded and aria-controls matching the disclosed panel', async () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} />);
    const toggle = screen.getByTestId('event-toggle-dp-1');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(controlsId!)).toBeInTheDocument();
  });
});

describe('UnifiedEventLog — timestamps', () => {
  it("shows each event's timestamp — 3b exists to reconstruct when things happened", () => {
    render(<UnifiedEventLog auditLogs={[auditEntry({ timestamp: '2026-08-12T17:40:00' })]} dispatches={[]} />);
    expect(screen.getByText('12/08 17:40:00')).toBeInTheDocument();
  });

  it('omits the timestamp column entirely for an event with no timestamp — not a dash', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry({ timestamp: null })]} dispatches={[]} />);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
