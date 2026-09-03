'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { formatScanTimestamp, type ScanHistoryEntry } from '@/lib/dispatch/mobile/scan-session';

/**
 * spec-76 2e — "ÚLTIMAS LECTURAS". Rejections render inline here too
 * (decision 5: "no bloquea la fila"), not in a separate list — the crew
 * scrolls one chronological log, not two.
 *
 * Lesson 8 (Lecciones aplicadas): this list grows by one row every scan —
 * a few hundred over a shift — and `history` is a NEW array reference on
 * every scan (client state is prepend-only). `Row` is `memo`'d so a scan
 * only ever mounts one new row instead of re-rendering every existing one;
 * it takes no callback props, so there is no `useCallback` half needed to
 * make that memoisation hold.
 */
export interface DispatchScanHistoryListProps {
  entries: readonly ScanHistoryEntry[];
}

export function DispatchScanHistoryList({ entries }: DispatchScanHistoryListProps) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[.06em] text-text-muted">Últimas lecturas</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-center text-[12.5px] text-text-secondary">
          Las lecturas de esta sesión aparecen aquí.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

const HistoryRow = memo(function HistoryRow({ entry }: { entry: ScanHistoryEntry }) {
  const isRejected = entry.kind === 'rejected';
  return (
    <div
      data-testid="dispatch-scan-history-row"
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2',
        isRejected ? 'border-status-error-border bg-status-error-bg' : 'border-border-subtle',
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-text">{entry.code}</span>
      {isRejected ? (
        <span className="flex-none font-mono text-[10px] font-semibold uppercase text-status-error-text">
          {entry.historyLabel}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
          {[entry.orderNumber, entry.comuna].filter(Boolean).join(' · ')}
        </span>
      )}
      <span className="flex-none font-mono text-[10px] text-text-muted">{formatScanTimestamp(entry.atIso)}</span>
    </div>
  );
});
