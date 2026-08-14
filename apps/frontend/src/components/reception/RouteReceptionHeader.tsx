'use client';

import { Truck, Package, Layers } from 'lucide-react';

interface RouteReceptionHeaderProps {
  code: string;
  driverName: string | null;
  /** The truck's registered plate (`vehicles.plate`), not the legacy label. */
  plate: string | null;
  manifestCount: number;
  expectedCount: number;
  receivedCount: number;
  /** Received packages with no verified pickup scan on this route. */
  unexpectedCount: number;
}

/**
 * spec-52: `expected_count` and `received_count` count DIFFERENT populations.
 * A package that arrives without a verified pickup scan on this route is
 * accepted and flagged unexpected — it increments `received_count` AND
 * `unexpected_count`. So `received/expected` is not a fraction of one whole and
 * presenting it as one actively misleads: 10/10 can hide a package left behind
 * at a client plus a package loaded off another truck.
 *
 * The honest display separates the populations:
 *
 *   matched = received - unexpected   -> packages that were expected AND came
 *
 * and renders `8/10 esperados · 1 inesperado`, with the unexpected set called
 * out only when there is one. The progress bar tracks `matched` for the same
 * reason — an unexpected package must never fill the bar toward "complete".
 */
export function RouteReceptionHeader({
  code,
  driverName,
  plate,
  manifestCount,
  expectedCount,
  receivedCount,
  unexpectedCount,
}: RouteReceptionHeaderProps) {
  const matchedCount = receivedCount - unexpectedCount;
  const pct = expectedCount > 0 ? Math.min(100, (matchedCount / expectedCount) * 100) : 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold text-text">{code}</p>
          {driverName && (
            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
              <Truck className="h-3 w-3" />
              {driverName}
              {plate ? ` · ${plate}` : ''}
            </p>
          )}
          <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
            <Layers className="h-3 w-3" />
            {manifestCount} manifiesto{manifestCount === 1 ? '' : 's'}
            <span className="mx-1">·</span>
            <Package className="h-3 w-3" />
            {expectedCount} paquetes esperados
          </p>
        </div>
        <div className="text-right">
          <p
            className="font-mono text-2xl font-bold text-text"
            data-testid="reception-counts"
          >
            {matchedCount}
            <span className="text-text-muted text-base font-normal"> / {expectedCount}</span>
          </p>
          <p className="text-xs text-text-secondary">
            esperados
            {unexpectedCount > 0 && (
              <>
                {' · '}
                <span className="text-status-warning" data-testid="unexpected-count">
                  {unexpectedCount} inesperado{unexpectedCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div
        className="w-full bg-border rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={expectedCount}
        aria-valuenow={matchedCount}
      >
        <div
          className="bg-accent h-2 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
