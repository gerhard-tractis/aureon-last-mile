'use client';

import { Truck, Package, Layers } from 'lucide-react';

interface RouteReceptionHeaderProps {
  code: string;
  driverName: string | null;
  vehicleLabel: string | null;
  manifestCount: number;
  expectedCount: number;
  receivedCount: number;
}

export function RouteReceptionHeader({
  code,
  driverName,
  vehicleLabel,
  manifestCount,
  expectedCount,
  receivedCount,
}: RouteReceptionHeaderProps) {
  const pct = expectedCount > 0 ? Math.min(100, (receivedCount / expectedCount) * 100) : 0;

  return (
    <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold text-text">{code}</p>
          {driverName && (
            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
              <Truck className="h-3 w-3" />
              {driverName}
              {vehicleLabel ? ` · ${vehicleLabel}` : ''}
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
          <p className="font-mono text-2xl font-bold text-text">
            {receivedCount}
            <span className="text-text-muted text-base font-normal"> / {expectedCount}</span>
          </p>
          <p className="text-xs text-text-secondary">recibidos</p>
        </div>
      </div>

      <div
        className="w-full bg-border rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={expectedCount}
        aria-valuenow={receivedCount}
      >
        <div
          className="bg-accent h-2 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
