'use client';

import { cn } from '@/lib/utils';
import { refocusPackageField } from '@/lib/scan/refocus-package-field';
import type { QuickSortFlowMode } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-71 phase 3 mobile, spec-96 Fase 1 (`4g`) — the Sectorizar/Estibar
 * (SECT/ESTIB) segmented toggle, extracted out of `QuickSortMobile.tsx`
 * (review round 2, "Also fix" #4 — that file crossed 300 lines). Lives in
 * `DistributionMobileHeader`'s title row via its `titleControl` slot; it
 * used to render as its own pill row below the whole header.
 *
 * Review findings #2/#3 — the artboard's box is ~91×23.5px at 9.5px mono,
 * nowhere near the 44px touch-target floor. Each `<button>` carries the
 * REAL 44px hit area via inline `minHeight`/`minWidth` (invisible), and an
 * inner `<span>` carries the artboard's visible sizing — deliberately two
 * different-sized boxes, rather than shrinking the touch-target floor or
 * inflating the visual pill past the mock.
 */
export interface QuickSortModeToggleProps {
  mode: QuickSortFlowMode;
  onModeChange: (mode: QuickSortFlowMode) => void;
}

export function QuickSortModeToggle({ mode, onModeChange }: QuickSortModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Modo de escaneo"
      className="flex flex-none items-center gap-0.5 rounded-[7px] border border-border bg-surface-raised p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'sectorize'}
        onClick={() => { onModeChange('sectorize'); refocusPackageField(); }}
        style={{ minHeight: '44px', minWidth: '44px' }}
        className="flex items-center justify-center"
      >
        <span
          className={cn(
            'rounded-[5px] px-2 py-1 font-mono text-[9.5px] transition-colors',
            mode === 'sectorize' ? 'bg-surface font-semibold text-text' : 'font-medium text-text-muted',
          )}
        >
          SECT
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'stage'}
        onClick={() => { onModeChange('stage'); refocusPackageField(); }}
        style={{ minHeight: '44px', minWidth: '44px' }}
        className="flex items-center justify-center"
      >
        <span
          className={cn(
            'rounded-[5px] px-2 py-1 font-mono text-[9.5px] transition-colors',
            mode === 'stage' ? 'bg-surface font-semibold text-text' : 'font-medium text-text-muted',
          )}
        >
          ESTIB
        </span>
      </button>
    </div>
  );
}
