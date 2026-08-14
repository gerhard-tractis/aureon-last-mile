'use client';

import { cn } from '@/lib/utils';
import type { QuickSortScanEvent } from './QuickSortScanner';
import type { UnmatchedComunaRow } from '@/hooks/distribution/useUnmatchedComunas';

/**
 * spec-54 phase 4.3 — "Últimos escaneos" (mock 1d, right column).
 *
 * The list is this session's scans, not a server feed: dock_scans is queried
 * per batch, and a batch is one package here, so there is no "recent scans"
 * endpoint to read. Session scope is also what the operator actually needs —
 * confirmation of what they just did, to catch a misfeed within a few seconds.
 *
 * "Comunas sin zona" lives at the foot of this panel rather than in a banner at
 * the top of the page, so the operator sees it while sorting instead of having
 * it pushed off screen by the dock grid.
 */

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

interface RecentScansPanelProps {
  scans: QuickSortScanEvent[];
  unmatchedComunas: UnmatchedComunaRow[];
}

export function RecentScansPanel({ scans, unmatchedComunas }: RecentScansPanelProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex flex-none items-baseline gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Últimos escaneos
        </h2>
        <span className="ml-auto font-mono text-[10.5px] font-medium leading-none text-text-muted">
          {scans.length} en esta sesión
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {scans.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">
            Los escaneos de esta sesión aparecen aquí.
          </p>
        ) : (
          scans.map((scan, i) => (
            <div
              key={`${scan.code}-${i}`}
              data-testid="recent-scan"
              className={cn(
                'flex items-center gap-2.5 border-b border-surface-raised px-4 py-2.5',
                scan.status === 'error' && 'bg-status-error-bg',
              )}
            >
              <span
                className={cn(
                  'truncate font-mono text-[11px] font-semibold',
                  scan.status === 'error' ? 'text-status-error-text' : 'text-text',
                )}
              >
                {scan.code}
              </span>
              {scan.status === 'error' ? (
                <span className="ml-auto flex-none font-mono text-[10px] font-semibold text-status-error-text">
                  {scan.reason ?? 'ERROR'}
                </span>
              ) : (
                <span className="ml-auto flex-none font-heading text-[11px] font-semibold text-status-success-text">
                  {scan.zoneCode}
                </span>
              )}
              <span className="flex-none font-mono text-[10px] font-medium text-text-muted">
                {timeLabel(scan.at)}
              </span>
            </div>
          ))
        )}
      </div>

      {unmatchedComunas.length > 0 && (
        <footer className="flex flex-none flex-col gap-2 border-t border-border bg-background px-4 py-3">
          <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
            Comunas sin zona
          </span>
          <div className="flex flex-wrap gap-1.5">
            {unmatchedComunas.map((c) => (
              <span
                key={c.comuna_raw}
                className="rounded-md border border-status-warning-border bg-status-warning-bg px-1.5 py-1 text-[10.5px] font-medium leading-none text-status-warning-text"
              >
                {c.comuna_raw} · {c.order_count}
              </span>
            ))}
          </div>
        </footer>
      )}
    </section>
  );
}
