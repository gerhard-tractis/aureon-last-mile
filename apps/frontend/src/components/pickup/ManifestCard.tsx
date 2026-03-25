'use client';

import { Package, ShoppingCart } from 'lucide-react';

interface ManifestCardProps {
  externalLoadId: string;
  retailerName: string | null;
  orderCount: number;
  packageCount: number;
  completedAt?: string;
  interactive?: boolean;
  onClick: () => void;
}

export function ManifestCard({
  externalLoadId,
  retailerName,
  orderCount,
  packageCount,
  completedAt,
  interactive = true,
  onClick,
}: ManifestCardProps) {
  const interactiveProps = interactive
    ? {
        onClick,
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') onClick();
        },
      }
    : {};

  const interactiveClasses = interactive
    ? 'cursor-pointer hover:border-accent/50'
    : '';

  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 transition-colors min-h-[72px] flex flex-col justify-center ${interactiveClasses}`}
      {...interactiveProps}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-text truncate">
            {retailerName || 'Retailer desconocido'}
          </h3>
          <p className="font-mono text-xs text-text-secondary mt-0.5">{externalLoadId}</p>
        </div>
        <div className="flex gap-3 text-sm text-text-secondary shrink-0">
          <div className="flex items-center gap-1">
            <ShoppingCart className="h-4 w-4" />
            <span className="font-mono">{orderCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <Package className="h-4 w-4" />
            <span className="font-mono">{packageCount}</span>
          </div>
        </div>
      </div>
      {completedAt && (
        <p className="text-xs text-text-muted mt-2">
          Completado el {new Date(completedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
