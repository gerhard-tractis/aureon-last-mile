'use client';

import { Check, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPickupWindowStatus, formatPickupWindowLabel } from '@/lib/pickup/pickupWindowStatus';

/**
 * spec-54 phase 4.4 — the manifest table on Recogida (mock `5a`).
 *
 * spec-83 fase 2 adds the VENTANA column the mock always asked for, once
 * `get_pending_manifests` started returning `pickup_window_start/end` and
 * `pickup_cutoff_time`. It is a column with its own semaphore, deliberately
 * NOT a third meaning on the row's left border — that border already carries
 * two *row states* (selection, scan-in-progress/merma); the window is a
 * *pickup-point datum* that changes on its own with the clock. See spec-83
 * fase 2 for the full reasoning against a shared channel.
 *
 * The semaphore has three states, not two: `sin_datos` is not `dentro_de_plazo`.
 * As of this phase no pickup point has a window configured, so defaulting an
 * absent deadline to "green" would assert something false, not just omit it.
 */

const WINDOW_STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  sin_datos: { dot: 'bg-border-strong', text: 'text-text-muted' },
  dentro_de_plazo: { dot: 'bg-status-success', text: 'text-status-success-text' },
  cerca_del_cierre: { dot: 'bg-status-warning', text: 'text-status-warning-text' },
};

export interface ManifestRow {
  /** NULL until a manifests row exists for the load (spec-53). */
  id: string | null;
  externalLoadId: string;
  pickupPoint: string | null;
  retailerName: string | null;
  orderCount: number;
  packageCount: number;
  /** Verified scans so far. >0 means collection is under way. */
  verifiedCount?: number;
  /** spec-83 fase 2 — pickup point's own window. NULL/undefined means "not
   * configured", never "no deadline" — see pickupWindowStatus.ts. */
  pickupWindowStart?: string | null;
  pickupWindowEnd?: string | null;
  /** spec-83 fase 2 — sla_config.pickup_cutoff_time, stricter than the
   * window end when both are set. */
  pickupCutoffTime?: string | null;
}

// The mock originally had six columns; spec-53 added a seventh (label
// printing) and spec-83 fase 2 adds the eighth (pickup window).
const GRID = 'grid grid-cols-[22px_118px_1fr_104px_72px_72px_96px_32px] gap-3';

interface ManifestTableProps {
  rows: ManifestRow[];
  /** Omit to render without checkboxes (the closed tabs). */
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  emptyMessage: string;
  /** spec-53 — module gate. No print affordance at all when false. */
  labelsEnabled?: boolean;
  onPrintLabels?: (manifestId: string) => void;
  /** Opens the load's scan flow. The row click is selection, so opening needs
   *  its own affordance — it is the main action on this screen. */
  onOpen?: (row: ManifestRow) => void;
  /** Injected for deterministic tests. Defaults to the real clock — the
   * semaphore reads how close "now" is to the close time. */
  now?: Date;
}

export function ManifestTable({
  rows,
  selectedIds,
  onToggle,
  emptyMessage,
  labelsEnabled = false,
  onPrintLabels,
  onOpen,
  now,
}: ManifestTableProps) {
  const selectable = !!selectedIds && !!onToggle;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          GRID,
          'flex-none border-b border-border bg-background px-4 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[.09em] text-text-secondary',
        )}
      >
        <span />
        <span>Carga</span>
        <span>Punto de recogida</span>
        <span>Cliente</span>
        <span className="text-right">Órdenes</span>
        <span className="text-right">Paq.</span>
        <span>Ventana</span>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">{emptyMessage}</p>
        ) : (
          rows.map((row) => {
            // A load with no manifests row yet cannot be added to a route —
            // there is nothing to link. It still shows, because the crew still
            // has to collect it.
            const selectableRow = selectable && row.id != null;
            const selected = row.id != null && selectedIds?.has(row.id);
            const inProgress = (row.verifiedCount ?? 0) > 0;

            return (
              <div
                key={row.externalLoadId}
                data-testid="manifest-row"
                role={selectableRow ? 'checkbox' : undefined}
                aria-checked={selectableRow ? !!selected : undefined}
                tabIndex={selectableRow ? 0 : undefined}
                onClick={() => selectableRow && onToggle!(row.id!)}
                onKeyDown={(e) => {
                  if (!selectableRow) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle!(row.id!);
                  }
                }}
                className={cn(
                  GRID,
                  'items-center border-b border-l-[3px] border-border-subtle px-4 py-3 transition-colors',
                  selected
                    ? 'border-l-accent bg-accent-muted'
                    : inProgress
                      ? 'border-l-status-warning'
                      : 'border-l-transparent',
                  selectableRow && 'cursor-pointer hover:bg-surface-raised',
                )}
              >
                {selectable ? (
                  <span
                    className={cn(
                      'grid h-4 w-4 place-items-center rounded border',
                      selected
                        ? 'border-accent bg-accent'
                        : row.id == null
                          ? 'border-border bg-surface-raised'
                          : 'border-border-strong bg-surface',
                    )}
                    title={row.id == null ? 'Sin manifiesto todavía' : undefined}
                  >
                    {selected && (
                      <Check className="h-2.5 w-2.5 text-accent-light-foreground" strokeWidth={3.4} />
                    )}
                  </span>
                ) : (
                  <span />
                )}

                {onOpen ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(row);
                    }}
                    className="truncate text-left font-mono text-[11.5px] font-semibold text-text underline-offset-2 hover:text-accent hover:underline"
                  >
                    {row.externalLoadId}
                  </button>
                ) : (
                  <span className="truncate font-mono text-[11.5px] font-semibold text-text">
                    {row.externalLoadId}
                  </span>
                )}

                <span className="min-w-0 truncate text-xs text-text-secondary">
                  {row.pickupPoint ?? '—'}
                </span>

                <span className="truncate text-[11.5px] text-text-secondary">
                  {row.retailerName ?? 'Sin cliente'}
                </span>

                <span className="text-right font-mono text-[11.5px] font-semibold text-text">
                  {row.orderCount}
                </span>

                <span className="text-right font-mono text-[11.5px] font-semibold text-text">
                  {row.packageCount}
                </span>

                {(() => {
                  const windowInput = {
                    pickupWindowStart: row.pickupWindowStart,
                    pickupWindowEnd: row.pickupWindowEnd,
                    pickupCutoffTime: row.pickupCutoffTime,
                  };
                  const status = getPickupWindowStatus(windowInput, now);
                  const style = WINDOW_STATUS_STYLES[status];
                  return (
                    <span
                      data-testid="pickup-window"
                      data-status={status}
                      className="flex items-center gap-1.5 truncate text-[11px]"
                    >
                      <span aria-hidden className={cn('h-1.5 w-1.5 flex-none rounded-full', style.dot)} />
                      <span className={cn('truncate', style.text)}>{formatPickupWindowLabel(windowInput)}</span>
                    </span>
                  );
                })()}

                {labelsEnabled && row.id && onPrintLabels ? (
                  <button
                    type="button"
                    aria-label={`Imprimir etiquetas de ${row.externalLoadId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrintLabels(row.id!);
                    }}
                    className="rounded p-1 text-text-muted transition-colors hover:text-accent"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
