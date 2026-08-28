'use client';

import { useState } from 'react';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import { useSealLoadPosition } from '@/hooks/dispatch/useSealLoadPosition';

export interface SealPositionCardProps {
  /**
   * Called whenever the card collapses back down — after a successful (or
   * idempotent) seal, or on an explicit cancel. Review fix #1: sealing used
   * to render an always-focused `ScanField` that raced the package field
   * for the scanner gun's input. Now the field only mounts once the
   * operator taps to reveal it, and this callback is how focus gets
   * handed back to the package field on the way down — the card itself
   * holds no reference to a sibling field it does not own.
   */
  onCollapse?: () => void;
}

/**
 * spec-71 phase 4 — the position seal's UI. Collapsed by default: a single
 * "Sellar posición" tap reveals the scan field, which the operator then
 * scans (or types) once every package for that position is staged. This
 * either seals it or refuses with the same `UNSEALED_STOPS`-style message
 * the route-level seal already shows in `RouteBuilder`. Deliberately
 * minimal — no move-task list (phase 5), no position picker: the operator
 * already knows the code, it's printed on the floor.
 *
 * Review fix #1 — collapsed-by-default is not just a focus fix. Sealing is
 * a deliberate, occasional act ("I have finished this position"); a scan
 * field that is always armed and competing with the package field for the
 * scanner gun's input is wrong regardless of who wins the focus race, so
 * the field does not exist in the DOM at all until the operator asks for
 * it.
 *
 * Shared verbatim between the desktop quicksort page and the mobile
 * distribution shell's `mode: 'stage'` step 1 (`QuickSortMobile`) — same
 * component, not a fork, so the two surfaces cannot drift.
 */
export function SealPositionCard({ onCollapse }: SealPositionCardProps) {
  const { sealPosition, isSealing } = useSealLoadPosition();
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<{ status: 'ok' | 'error'; title: string; code?: string } | null>(
    null,
  );

  const reveal = () => {
    setResult(null);
    setRevealed(true);
  };

  const collapse = () => {
    setRevealed(false);
    onCollapse?.();
  };

  const onScanPosition = async (code: string) => {
    const outcome = await sealPosition(code);
    if (!outcome.ok) {
      // Stays revealed — a refusal (e.g. UNSEALED_STOPS) is something the
      // operator acts on right here, not a reason to lose the field.
      setResult({ status: 'error', title: outcome.message ?? 'No se pudo sellar la posición' });
      return;
    }
    setResult({
      status: 'ok',
      title: outcome.alreadySealed
        ? 'Posición ya estaba sellada'
        : `Posición sellada · ${outcome.sealedStops ?? 0} parada(s)`,
      code: outcome.positionCode,
    });
    collapse();
  };

  if (!revealed) {
    return (
      <div
        data-testid="seal-position-card"
        className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5"
      >
        <button
          type="button"
          onClick={reveal}
          className="flex h-11 items-center justify-center rounded-lg border border-border bg-surface-raised px-4 font-mono text-[11px] font-semibold uppercase tracking-[.08em] text-text transition-colors active:bg-surface"
        >
          Sellar posición
        </button>
        {result && <ScanResult status={result.status} title={result.title} code={result.code} />}
      </div>
    );
  }

  return (
    <div
      data-testid="seal-position-card"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-text-muted">
          Sellar posición
        </span>
        <button
          type="button"
          onClick={collapse}
          className="flex h-11 items-center rounded-lg px-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-text-secondary transition-colors active:bg-surface-raised"
        >
          Cancelar
        </button>
      </div>
      <ScanField
        ariaLabel="Escanear posición a sellar"
        size="sm"
        onScan={(code) => {
          void onScanPosition(code);
        }}
        helperText="Escanea la posición cuando esté completa"
        disabled={isSealing}
      />
      {result && <ScanResult status={result.status} title={result.title} code={result.code} />}
    </div>
  );
}
