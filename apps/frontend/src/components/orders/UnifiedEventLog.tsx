'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { decodeEvent } from '@/lib/orders/event-decoder';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 7 — the merged bitácora. With Fase 1 (`webhook_events`)
 * parked, DISPATCHTRACK has no per-event history: `beetrack-webhook`
 * upserts one row per stop, so each `dispatches` row becomes exactly one
 * synthetic entry here, showing the courier's *current* state — not "9 of
 * 14 events" like the mock, because there is no event count to show.
 * AUREON entries come straight from `audit_logs`.
 *
 * Review round 1 correction — the original brief for this component
 * described the source badge and the expandable four-field/raw-JSON
 * payload but never said "show the timestamp", even though the `3b`
 * artboard shows one on every row. `3b` exists to reconstruct disputes;
 * a bitácora where you can't see *when* something happened doesn't serve
 * that. Each row now shows its timestamp (omitted, not dashed, when the
 * event has none) via `event.timestamp`, which was already being sorted
 * on but never rendered.
 */
interface Props {
  auditLogs: AuditEntry[];
  dispatches: DossierDispatch[];
}

type UnifiedEvent =
  | { source: 'aureon'; id: string; timestamp: string | null; title: string; raw: unknown }
  | { source: 'dispatchtrack'; id: string; timestamp: string | null; dispatch: DossierDispatch };

function dispatchTimestamp(d: DossierDispatch): string | null {
  return d.completed_at ?? d.arrived_at ?? d.estimated_at ?? null;
}

function buildEvents(auditLogs: AuditEntry[], dispatches: DossierDispatch[]): UnifiedEvent[] {
  const auditEvents: UnifiedEvent[] = auditLogs.map((log) => ({
    source: 'aureon',
    id: log.id,
    timestamp: log.timestamp,
    title: log.action,
    raw: log.changes_json,
  }));
  const dispatchEvents: UnifiedEvent[] = dispatches.map((d) => ({
    source: 'dispatchtrack',
    id: d.id,
    timestamp: dispatchTimestamp(d),
    dispatch: d,
  }));

  return [...auditEvents, ...dispatchEvents].sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.localeCompare(a.timestamp);
  });
}

function GridField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-border-subtle p-2.5 [&:nth-child(odd)]:border-r">
      <span className="font-mono text-[9.5px] tracking-wide text-text-muted">{label}</span>
      <span className="text-[11px] text-text-body">{value}</span>
    </div>
  );
}

/**
 * spec-65 Task 7, review round 1 — the raw-JSON disclosure shared by both
 * AUREON and DISPATCHTRACK bodies. Previously only the dispatch body read
 * this; an audit entry's toggle rendered but did nothing, which — with
 * Fase 1 parked and AUREON entries the only entries for most orders — was
 * the interaction users hit most.
 */
function TechnicalDataDisclosure({ id, data }: { id: string; data: unknown }) {
  const [showRaw, setShowRaw] = useState(false);
  const panelId = `event-raw-${id}`;

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 bg-surface-raised px-2.5 py-1.5">
        <button
          type="button"
          aria-expanded={showRaw}
          aria-controls={panelId}
          onClick={() => setShowRaw((v) => !v)}
          className="text-[10px] font-medium text-accent"
        >
          Ver datos técnicos
        </button>
      </div>
      {showRaw && (
        <pre
          id={panelId}
          className="overflow-x-auto border-t border-border-subtle bg-background p-2.5 text-[10px] text-text-secondary"
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DispatchEventBody({ dispatch }: { dispatch: DossierDispatch }) {
  const decoded = decodeEvent(dispatch);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface">
        <GridField label="MOTIVO" value={decoded.motivoCode ? `${decoded.motivo} (${decoded.motivoCode})` : decoded.motivo} />
        {decoded.intento && <GridField label="INTENTO" value={decoded.intento} />}
        {decoded.ubicacion && <GridField label="UBICACIÓN" value={decoded.ubicacion} />}
        <GridField label="RESPALDO" value={decoded.respaldo} />
      </div>
      <TechnicalDataDisclosure id={dispatch.id} data={dispatch.raw_data} />
    </div>
  );
}

function formatEventTimestamp(timestamp: string): string {
  return format(new Date(timestamp), 'dd/MM HH:mm:ss');
}

export function UnifiedEventLog({ auditLogs, dispatches }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const events = buildEvents(auditLogs, dispatches);

  if (events.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-text-secondary" data-testid="event-log-empty">
        Sin eventos registrados.
      </p>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-0" data-testid="unified-event-log">
      {dispatches.length === 0 && (
        <p className="px-1 pb-3 text-[11.5px] text-text-secondary">Sin eventos de courier registrados.</p>
      )}
      {events.map((event) => {
        const isOpen = expanded.has(event.id);
        const bodyId = `event-body-${event.id}`;
        return (
          <div
            key={`${event.source}-${event.id}`}
            className="flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
          >
            {event.timestamp && (
              <span className="w-[74px] flex-none pt-0.5 font-mono text-[10.5px] text-text-muted">
                {formatEventTimestamp(event.timestamp)}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid={`event-toggle-${event.id}`}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => toggle(event.id)}
                  className="text-left text-[12px] font-medium text-text-body"
                >
                  {event.source === 'aureon' ? event.title : event.dispatch.substatus || 'Actualización de courier'}
                </button>
                <span
                  className={cn(
                    'rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wide',
                    event.source === 'aureon'
                      ? 'border-accent bg-accent-light text-accent-foreground'
                      : 'border-border bg-surface-raised text-text-secondary',
                  )}
                >
                  {event.source === 'aureon' ? 'AUREON' : 'DISPATCHTRACK'}
                </span>
              </div>
              {isOpen && (
                <div id={bodyId}>
                  {event.source === 'dispatchtrack' ? (
                    <DispatchEventBody dispatch={event.dispatch} />
                  ) : (
                    <TechnicalDataDisclosure id={event.id} data={event.raw} />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
