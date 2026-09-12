'use client';

import Link from 'next/link';
import { ScanLine } from 'lucide-react';

/**
 * spec-96 Fase 2 review — the fixed footer for `/pendientes` (`4d`), split
 * out of `page.tsx` to keep that file under the length floor. SEL's
 * confirm action shares this SAME fixed footer as Escanear/SEL (`4f`'s
 * shape — counter eyebrow, then the primary action,
 * `Distribucion.dc.html:804-811`), never a second floating element: the
 * confirm bar first shipped as a `sticky bottom-0` region inside the
 * scrolling list with no `z-index`, painted over by this exact footer
 * (fixed, opaque, `z-40`) at every scroll position where the list
 * overflows — the window is the scroll container, since `AppLayout`'s
 * `<main>` has no `overflow-y-auto`.
 *
 * `FOOTER_METRICS`/`getFooterContentHeight` follow the pattern
 * `ConsolidationPageContent` established for the identical failure mode
 * (spec-96 Fase 3 review, must-fix 2): one object sizes both the visible
 * footer's rows and the scroll clearance the page reserves above it, so
 * they cannot silently disagree. Kept local to this component rather than
 * imported from `ConsolidationPageContent.tsx`, which isn't in this
 * phase's file surface.
 */
export const FOOTER_METRICS = {
  paddingY: 12,
  gap: 10,
  baseRowHeight: 56,
  counterRowHeight: 20,
  confirmButtonHeight: 56,
} as const;

export function getFooterContentHeight(hasSelectionFooter: boolean): number {
  const rows = hasSelectionFooter
    ? [FOOTER_METRICS.counterRowHeight, FOOTER_METRICS.confirmButtonHeight]
    : [FOOTER_METRICS.baseRowHeight];
  return (
    FOOTER_METRICS.paddingY * 2 +
    rows.reduce((sum, n) => sum + n, 0) +
    (rows.length - 1) * FOOTER_METRICS.gap
  );
}

export function PendingSelectionFooter({
  selectionMode,
  selectedCount,
  canManualAssign,
  onToggleSelectionMode,
  onConfirmSelection,
}: {
  selectionMode: boolean;
  selectedCount: number;
  canManualAssign: boolean;
  onToggleSelectionMode: () => void;
  onConfirmSelection: () => void;
}) {
  const hasSelectionFooter = selectionMode && selectedCount > 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-border bg-surface px-4"
      style={{
        gap: FOOTER_METRICS.gap,
        paddingTop: FOOTER_METRICS.paddingY,
        paddingBottom: `calc(${FOOTER_METRICS.paddingY}px + env(safe-area-inset-bottom))`,
      }}
    >
      {hasSelectionFooter ? (
        <>
          <div className="flex items-center" style={{ height: FOOTER_METRICS.counterRowHeight }}>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[.1em] text-text-secondary">
              {selectedCount} {selectedCount === 1 ? 'SELECCIONADO' : 'SELECCIONADOS'}
            </span>
          </div>
          <button
            type="button"
            data-testid="pending-selection-confirm"
            onClick={onConfirmSelection}
            style={{ height: FOOTER_METRICS.confirmButtonHeight }}
            className="flex w-full items-center justify-center rounded-xl bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            Enviar seleccionados
          </button>
        </>
      ) : (
        <div className="flex items-center gap-3" style={{ height: FOOTER_METRICS.baseRowHeight }}>
          <Link
            href="/app/distribution/quicksort"
            className="flex h-full flex-1 items-center justify-center gap-2 rounded-xl bg-accent-light px-6 text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            <ScanLine className="h-5 w-5" />
            Escanear
          </Link>
          {canManualAssign && (
            <button
              type="button"
              aria-pressed={selectionMode}
              onClick={onToggleSelectionMode}
              data-testid="pendientes-sel-toggle"
              className={`flex h-full w-[56px] flex-none items-center justify-center rounded-xl border font-mono text-[11px] font-semibold ${
                selectionMode ? 'border-accent bg-accent-muted text-accent' : 'border-border-strong text-text-body'
              }`}
            >
              SEL
            </button>
          )}
        </div>
      )}
    </div>
  );
}
