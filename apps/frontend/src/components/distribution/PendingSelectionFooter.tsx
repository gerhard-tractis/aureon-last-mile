'use client';

import Link from 'next/link';
import { ScanLine } from 'lucide-react';

/**
 * spec-96 Fase 2 review — the fixed footer for `/pendientes` (`4d`), split
 * out of `page.tsx` to keep that file under the length floor. SEL's
 * confirm action shares this SAME fixed footer as Escanear/SEL (`4f`'s
 * shape — counter eyebrow, then the primary action, then a secondary
 * escape row — `Distribucion.dc.html:804-811`), never a second floating
 * element: the confirm bar first shipped as a `sticky bottom-0` region
 * inside the scrolling list with no `z-index`, painted over by this exact
 * footer (fixed, opaque, `z-40`) at every scroll position where the list
 * overflows — the window is the scroll container, since `AppLayout`'s
 * `<main>` has no `overflow-y-auto`.
 *
 * Round-2 review — swapping the footer's entire contents once anything is
 * ticked ALSO unmounted the only two controls (`SEL`, Escanear) that could
 * exit selection mode, so a mis-tap could only be sent, hunted back down
 * in the scroll, or escaped by leaving the screen. `4f` never drops to a
 * primary-only footer either — its secondary row (`Liberar a
 * sectorización`) is always present alongside the counter and the primary
 * action. `Cancelar selección` below is this screen's equivalent: always
 * reachable once anything is selected, exits selection mode AND clears
 * the set (same handler `SEL` itself uses to turn off).
 *
 * `FOOTER_METRICS` values are `4d`'s own footer (`:664`), not copied from
 * `ConsolidationPageContent`: `padding:14px 20px 26px` (top/bottom
 * asymmetric — the extra bottom keeps the button clear of the home
 * indicator even where `env(safe-area-inset-bottom)` is `0`), `gap:10`,
 * button height `56`, radius `13`. `getFooterContentHeight` still follows
 * the pattern `ConsolidationPageContent` established for the identical
 * failure mode (spec-96 Fase 3 review, must-fix 2): one object sizes both
 * the visible footer's rows and the scroll clearance the page reserves
 * above it, so they cannot silently disagree.
 */
export const FOOTER_METRICS = {
  paddingTop: 14,
  paddingX: 20,
  paddingBottom: 26,
  gap: 10,
  baseRowHeight: 56,
  counterRowHeight: 20,
  confirmButtonHeight: 56,
  cancelButtonHeight: 52,
} as const;

export function getFooterContentHeight(hasSelectionFooter: boolean): number {
  const rows = hasSelectionFooter
    ? [FOOTER_METRICS.counterRowHeight, FOOTER_METRICS.confirmButtonHeight, FOOTER_METRICS.cancelButtonHeight]
    : [FOOTER_METRICS.baseRowHeight];
  return (
    FOOTER_METRICS.paddingTop +
    FOOTER_METRICS.paddingBottom +
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
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-border bg-surface"
      style={{
        gap: FOOTER_METRICS.gap,
        paddingTop: FOOTER_METRICS.paddingTop,
        paddingLeft: FOOTER_METRICS.paddingX,
        paddingRight: FOOTER_METRICS.paddingX,
        paddingBottom: `calc(${FOOTER_METRICS.paddingBottom}px + env(safe-area-inset-bottom))`,
      }}
    >
      {hasSelectionFooter ? (
        <>
          <div className="flex items-center" style={{ height: FOOTER_METRICS.counterRowHeight }}>
            <span
              data-testid="pending-selection-count"
              className="font-mono text-[11px] font-semibold uppercase tracking-[.1em] text-text-secondary"
            >
              {selectedCount}
            </span>
          </div>
          <button
            type="button"
            data-testid="pending-selection-confirm"
            onClick={onConfirmSelection}
            style={{ height: FOOTER_METRICS.confirmButtonHeight }}
            className="flex w-full items-center justify-center rounded-[13px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            Enviar seleccionados
          </button>
          <button
            type="button"
            data-testid="pending-selection-cancel"
            onClick={onToggleSelectionMode}
            style={{ height: FOOTER_METRICS.cancelButtonHeight }}
            className="flex w-full items-center justify-center rounded-[13px] border border-border-strong bg-surface text-[13px] font-semibold text-text transition-colors active:bg-surface-raised"
          >
            Cancelar selección
          </button>
        </>
      ) : (
        <div className="flex items-center gap-[10px]" style={{ height: FOOTER_METRICS.baseRowHeight }}>
          <Link
            href="/app/distribution/quicksort"
            className="flex h-full flex-1 items-center justify-center gap-2 rounded-[13px] bg-accent-light px-6 text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
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
              className={`flex h-full w-[56px] flex-none items-center justify-center rounded-[13px] border font-mono text-[11px] font-semibold ${
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
