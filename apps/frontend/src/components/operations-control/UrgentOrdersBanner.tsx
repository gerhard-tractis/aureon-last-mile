'use client';

/**
 * UrgentOrdersBanner
 * Alert banner shown when urgent or late orders exist.
 * Dismissible via local state; re-appears when counts change and are > 0.
 */

import { useState, useEffect, useRef } from 'react';

interface UrgentOrdersBannerProps {
  urgentCount: number;
  lateCount: number;
  onViewUrgent: () => void;
}

export function UrgentOrdersBanner({
  urgentCount,
  lateCount,
  onViewUrgent,
}: UrgentOrdersBannerProps) {
  const totalCount = urgentCount + lateCount;

  // Track whether the banner has been dismissed for the current "batch" of alerts.
  // We store the total count at the time of dismissal so we can re-show when
  // a new (different) non-zero total arrives.
  const [dismissedTotal, setDismissedTotal] = useState<number | null>(null);
  const prevTotalRef = useRef(totalCount);

  // Re-show when counts change from 0 → >0 (or from one non-zero value to another)
  useEffect(() => {
    const prevTotal = prevTotalRef.current;
    // If the new total is > 0 and different from the previous total, reset dismissal
    if (totalCount > 0 && totalCount !== prevTotal) {
      setDismissedTotal(null);
    }
    prevTotalRef.current = totalCount;
  }, [totalCount]);

  // Nothing to show
  if (totalCount === 0) {
    return null;
  }

  // Banner was dismissed for this exact total — stay hidden
  if (dismissedTotal === totalCount) {
    return null;
  }

  return (
    <div
      data-testid="urgent-banner"
      className="flex items-center justify-between gap-3 px-4 py-3 bg-red-600 text-white text-sm"
      role="alert"
    >
      <span className="font-medium">
        {totalCount} pedidos requieren atención inmediata
      </span>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onViewUrgent}
          className="px-3 py-1 text-xs font-semibold bg-white text-red-700 rounded hover:bg-red-50"
        >
          Ver urgentes
        </button>

        <button
          data-testid="urgent-banner-dismiss"
          onClick={() => setDismissedTotal(totalCount)}
          className="text-white hover:text-red-100 font-bold text-lg leading-none"
          aria-label="Cerrar alerta"
        >
          ×
        </button>
      </div>
    </div>
  );
}
