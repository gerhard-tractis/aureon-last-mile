'use client';

import { useIsOnline } from '@/components/distribution/DistributionMobileHeader';

/**
 * spec-76 2a header. Deliberately thin: the artboard's `09:14 / 5G /
 * battery` strip is the phone's OS chrome and is not built (spec-76
 * Lecciones aplicadas #2 / decision 10) — only `EN LÍNEA` is this module's
 * own, so only that renders here. `useIsOnline` is reused as-is from
 * Distribution (spec-68) rather than a second copy of the same
 * `navigator.onLine` + online/offline listener logic (spec-76 decision 2:
 * share what's already shared).
 */
export interface DispatchCrewMobileHeaderProps {
  driverName: string | null;
}

export function DispatchCrewMobileHeader({ driverName }: DispatchCrewMobileHeaderProps) {
  const isOnline = useIsOnline();
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <div>
        <p className="font-heading text-[15px] font-semibold text-text">
          {driverName ? `Hola, ${driverName}` : 'Despacho'}
        </p>
      </div>
      <span
        className={`rounded-sm border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] ${
          isOnline
            ? 'border-status-success-border bg-status-success-bg text-status-success-text'
            : 'border-status-error-border bg-status-error-bg text-status-error-text'
        }`}
      >
        {isOnline ? 'EN LÍNEA' : 'SIN CONEXIÓN'}
      </span>
    </header>
  );
}
