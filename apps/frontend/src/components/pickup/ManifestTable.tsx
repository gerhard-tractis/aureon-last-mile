'use client';

import { Check, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.4 — the manifest table on Recogida (mock 1l).
 *
 * The mock's last column is a pickup window ("09:00–13:00", "cierra 12:30" in
 * red), with the row's left border coloured by how close that close-time is.
 * get_pending_manifests returns no pickup window, so neither is rendered:
 * inventing a deadline on the screen that decides what the crew collects next
 * would be worse than leaving the column out. The border instead carries
 * scan progress, which is real.
 */

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
}

// The mock has six columns. The seventh is ours: spec-53 label printing lives
// on this row today, and a redesign that quietly dropped it would be a
// functional regression, not a visual change.
const GRID = 'grid grid-cols-[22px_118px_1fr_104px_72px_72px_32px] gap-3';

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
}

export function ManifestTable({
  rows,
  selectedIds,
  onToggle,
  emptyMessage,
  labelsEnabled = false,
  onPrintLabels,
  onOpen,
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
