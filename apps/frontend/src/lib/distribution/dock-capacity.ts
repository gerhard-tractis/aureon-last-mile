// apps/frontend/src/lib/distribution/dock-capacity.ts
//
// spec-68 Fase 1 (Decisión 5) — the single place that turns a dock zone's
// package count and its (possibly unset) capacity into: a fill percentage,
// a presentation tone, and the "quedan N espacios" copy. Four screens read
// this (`4e`, the quicksort step-2 screen, `/andenes`, and optionally the
// desktop `DockCard`) — writing the arithmetic four times is how it drifts.
//
// Capacity is nullable in the schema on purpose (see migration
// 20260824000005): a zone nobody configured must render with no bar and no
// threshold, never a bar pinned at 0%. This module treats `0` and negative
// capacity the same as `null` — a defensive floor, since the schema has no
// CHECK constraint enforcing positivity.

export type DockCapacityTone = 'neutral' | 'warning' | 'error';

export interface DockCapacityStatus {
  /** False when capacity is not configured (null, 0, or negative). */
  configured: boolean;
  /** Fill percentage, e.g. 93.9 for 169/180. Not clamped above 100 — the UI
   *  needs to know a zone is over capacity, not just "full". Null when not
   *  configured. */
  fillPct: number | null;
  /** Presentation tone. Null when not configured — render no bar, no
   *  threshold copy. */
  tone: DockCapacityTone | null;
  /** "Quedan N espacios" (or "Queda 1 espacio"), N clamped at 0. Null when
   *  not configured. */
  remainingLabel: string | null;
}

const WARNING_THRESHOLD_PCT = 90;
const FULL_THRESHOLD_PCT = 100;

function toneForFillPct(fillPct: number): DockCapacityTone {
  if (fillPct >= FULL_THRESHOLD_PCT) return 'error';
  if (fillPct >= WARNING_THRESHOLD_PCT) return 'warning';
  return 'neutral';
}

function remainingLabel(remaining: number): string {
  return remaining === 1 ? 'Queda 1 espacio' : `Quedan ${remaining} espacios`;
}

export function getDockCapacityStatus(
  count: number,
  capacity: number | null,
): DockCapacityStatus {
  if (capacity == null || capacity <= 0) {
    return { configured: false, fillPct: null, tone: null, remainingLabel: null };
  }

  const safeCount = Math.max(0, count);
  const fillPct = (safeCount / capacity) * 100;
  const remaining = Math.max(0, capacity - safeCount);

  return {
    configured: true,
    fillPct,
    tone: toneForFillPct(fillPct),
    remainingLabel: remainingLabel(remaining),
  };
}
