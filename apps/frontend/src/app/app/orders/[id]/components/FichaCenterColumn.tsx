'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { UnifiedEventLog, type EventSourceFilter } from '@/components/orders/UnifiedEventLog';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 9 — `3b`'s centre column: the mock's Todo / Aureon /
 * DispatchTrack source filter around `UnifiedEventLog` (Task 7).
 *
 * Controller-authorized extension, round 2 — the filter selection lives
 * here (a `3b`-only affordance `1f` never asked for), but the actual
 * filtering of `auditLogs`/`dispatches` now happens INSIDE
 * `UnifiedEventLog` via its `sourceFilter` prop, not by this component
 * pre-filtering the arrays before passing them down. This column always
 * passes the full, real `auditLogs`/`dispatches` through — only
 * `UnifiedEventLog` can tell "no courier events exist for this order"
 * apart from "courier events exist but are hidden by the current filter",
 * and wording each correctly requires seeing both the real data and the
 * active filter at once.
 *
 * The total "N eventos" count is always the unfiltered total, matching the
 * mock: it answers "how much is in this bitácora", not "how much survived
 * the filter".
 */
interface Props {
  auditLogs: AuditEntry[];
  dispatches: DossierDispatch[];
}

const FILTERS: { id: EventSourceFilter; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'aureon', label: 'Aureon' },
  { id: 'dispatchtrack', label: 'DispatchTrack' },
];

export function FichaCenterColumn({ auditLogs, dispatches }: Props) {
  const [source, setSource] = useState<EventSourceFilter>('all');
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
        <UnifiedEventLog auditLogs={auditLogs} dispatches={dispatches} sourceFilter={source} />
      </div>
    </div>
  );
}
