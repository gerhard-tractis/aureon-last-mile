'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { UnifiedEventLog } from '@/components/orders/UnifiedEventLog';
import { filterAuditLogsBySource, filterDispatchesBySource, type EventSourceFilter } from '../_ficha-helpers';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 9 — `3b`'s centre column: the mock's Todo / Aureon /
 * DispatchTrack source filter, wrapping `UnifiedEventLog` (Task 7)
 * unmodified. The filter lives here, not inside `UnifiedEventLog` — it's a
 * `3b`-only affordance `1f` never asked for, and Task 7's component stays a
 * pure presentational block over whatever `auditLogs`/`dispatches` it's
 * given.
 *
 * The total "N eventos" count is always the unfiltered total, matching the
 * mock: it answers "how much is in this bitácora", not "how much survived
 * the filter". `UnifiedEventLog`'s own "Sin eventos de courier
 * registrados." notice can read oddly while "Aureon" is selected on an
 * order that does have courier events — a known, accepted trade-off of
 * composing Task 7's block unmodified rather than teaching it about a
 * filter reason it was never given (see the task report).
 */
interface Props {
  auditLogs: AuditEntry[];
  dispatches: DossierDispatch[];
}

const FILTERS: { id: EventSourceFilter; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'aureon', label: 'Aureon' },
  { id: 'dispatchtrack', label: 'DispatchTrack' },
];

export function FichaCenterColumn({ auditLogs, dispatches }: Props) {
  const [source, setSource] = useState<EventSourceFilter>('todo');
  const totalEvents = auditLogs.length + dispatches.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-b border-border bg-surface lg:border-b-0">
      <div className="flex flex-none items-center gap-2.5 border-b border-border-subtle px-5 py-3">
        <h2 className="font-heading text-[12.5px] font-semibold text-text">Bitácora unificada</h2>
        <span className="font-mono text-[10.5px] text-text-muted">{totalEvents} eventos</span>
        <div className="ml-auto flex gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSource(f.id)}
              className={cn(
                'rounded px-2 py-1 text-[10.5px] font-medium transition-colors',
                source === f.id ? 'bg-surface text-text' : 'text-text-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        <UnifiedEventLog
          auditLogs={filterAuditLogsBySource(auditLogs, source)}
          dispatches={filterDispatchesBySource(dispatches, source)}
        />
      </div>
    </div>
  );
}
