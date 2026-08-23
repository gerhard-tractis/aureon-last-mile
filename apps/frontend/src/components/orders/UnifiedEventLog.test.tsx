import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnifiedEventLog } from './UnifiedEventLog';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';
import { dossierDispatchFixture } from '@/test/fixtures/dossierDispatch';

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
  return dossierDispatchFixture({
    id: 'dp-1',
    substatus: 'Recibido por cliente',
    substatus_code: '00',
    status: 'delivered',
    completed_at: '2026-08-13T12:41:08',
    raw_data: { attempt: 1, accuracy_m: 42 },
    ...overrides,
  });
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

  it('pairs the AUREON badge fill with the light-foreground text token, not the (white) default foreground', () => {
    // `bg-accent-light` + `text-accent-foreground` fails contrast (~1.9:1,
    // see globals.css) — every other `bg-accent-light` site in the repo
    // pairs it with `text-accent-light-foreground`. This is the most common
    // badge in the log, so a regression here is highly visible.
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[]} />);
    const badge = screen.getByText('AUREON');
    expect(badge.className).toContain('text-accent-light-foreground');
    expect(badge.className).not.toContain('text-accent-foreground');
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

describe('UnifiedEventLog — sourceFilter', () => {
  it('defaults to showing every event when sourceFilter is omitted', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} />);
    expect(screen.getByText('AUREON')).toBeInTheDocument();
    expect(screen.getByText('DISPATCHTRACK')).toBeInTheDocument();
  });

  it('sourceFilter="all" shows both AUREON and DISPATCHTRACK entries', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="all" />);
    expect(screen.getByText('AUREON')).toBeInTheDocument();
    expect(screen.getByText('DISPATCHTRACK')).toBeInTheDocument();
  });

  it('sourceFilter="aureon" hides DISPATCHTRACK entries', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="aureon" />);
    expect(screen.getByText('AUREON')).toBeInTheDocument();
    expect(screen.queryByText('DISPATCHTRACK')).not.toBeInTheDocument();
  });

  it('sourceFilter="dispatchtrack" hides AUREON entries', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="dispatchtrack" />);
    expect(screen.queryByText('AUREON')).not.toBeInTheDocument();
    expect(screen.getByText('DISPATCHTRACK')).toBeInTheDocument();
  });

  // The bug the controller flagged: filtering the component's INPUTS from
  // the outside made this message lie ("no courier events registered")
  // when the truth was "the user filtered them away". Filtering internally
  // means the component can tell the difference.
  it('does not show the courier-absence message when courier events exist but are hidden by the Aureon filter', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="aureon" />);
    expect(screen.queryByText(/Sin eventos de courier registrados/)).not.toBeInTheDocument();
  });

  it('still shows the courier-absence message under the Aureon filter when courier events genuinely do not exist', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[]} sourceFilter="aureon" />);
    expect(screen.getByText(/Sin eventos de courier registrados/)).toBeInTheDocument();
  });

  it('says courier events are hidden by the filter, worded differently from genuine absence', () => {
    render(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="aureon" />);
    expect(screen.getByText(/oculto/i)).toBeInTheDocument();
  });

  it('does not show the courier-hidden-by-filter message under "all" or "dispatchtrack"', () => {
    const { rerender } = render(
      <UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="all" />,
    );
    expect(screen.queryByText(/oculto/i)).not.toBeInTheDocument();
    rerender(<UnifiedEventLog auditLogs={[auditEntry()]} dispatches={[dispatchRow()]} sourceFilter="dispatchtrack" />);
    expect(screen.queryByText(/oculto/i)).not.toBeInTheDocument();
  });
});

// Controller-flagged Critical, round 3 — the zero-events early return used
// to fire off the FILTERED count alone, so it said "Sin eventos
// registrados." even when real events existed and were merely hidden by
// the active filter. Both reachable cases below have exactly ONE source
// populated (unlike the describe block above, which always supplies both
// sources and so never drove `events.length` to zero).
describe('UnifiedEventLog — zero visible events under a filter (critical fix)', () => {
  it('says Aureon events are hidden, not that none exist, when 5 Aureon events are filtered out under "DispatchTrack"', () => {
    const logs = Array.from({ length: 5 }, (_, i) => auditEntry({ id: `audit-${i}` }));
    render(<UnifiedEventLog auditLogs={logs} dispatches={[]} sourceFilter="dispatchtrack" />);
    expect(screen.queryByText(/Sin eventos registrados/)).not.toBeInTheDocument();
    expect(screen.getByText(/5 eventos de Aureon ocultos/i)).toBeInTheDocument();
  });

  it('says courier events are hidden, not that none exist, when 1 courier event is filtered out under "Aureon"', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} sourceFilter="aureon" />);
    expect(screen.queryByText(/Sin eventos registrados/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 evento de courier oculto/i)).toBeInTheDocument();
  });

  it('still says plainly that nothing is registered when both sources are genuinely empty, regardless of filter', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[]} sourceFilter="aureon" />);
    expect(screen.getByText(/Sin eventos registrados/)).toBeInTheDocument();
  });

  it('does not render the event list container when the zero-events branch fires', () => {
    render(<UnifiedEventLog auditLogs={[]} dispatches={[dispatchRow()]} sourceFilter="aureon" />);
    expect(screen.queryByTestId('unified-event-log')).not.toBeInTheDocument();
  });
});
