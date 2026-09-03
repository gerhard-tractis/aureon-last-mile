'use client';

import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { OrderPackage } from '@/hooks/dispatch/pre-route/useOrderPackages';

/**
 * spec-75 Task 2a — the chevron's expanded content: one order's packages,
 * fetched lazily by `useOrderPackages`. A package held in consolidation
 * (`status === 'retenido'`) is marked here because it is the root cause of
 * orders shipping incomplete — matches the warning treatment
 * `OrderPackageList` already uses for the same status.
 */
interface UnroutedOrderPackagesProps {
  packages: OrderPackage[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function UnroutedOrderPackages({ packages, isLoading, isError }: UnroutedOrderPackagesProps) {
  if (isLoading) {
    return (
      <div data-testid="order-packages-loading" className="flex flex-col gap-1.5 px-4 py-2.5">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-2.5 text-[11px] text-status-error-text">
        No se pudieron cargar los paquetes de esta orden.
      </p>
    );
  }

  if (!packages || packages.length === 0) {
    return <p className="px-4 py-2.5 text-[11px] text-text-muted">Sin paquetes registrados.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5 px-4 py-2.5">
      {packages.map((pkg) => (
        <li
          key={pkg.id}
          data-testid={`package-row-${pkg.id}`}
          className={cn(
            'flex flex-col gap-1 rounded-md border px-2.5 py-2',
            pkg.isHeld ? 'border-status-warning-border bg-status-warning-bg' : 'border-border-subtle',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold text-text">{pkg.label}</span>
            {pkg.isHeld && (
              <span
                data-testid={`package-held-${pkg.id}`}
                className="flex items-center gap-1 text-[10px] font-medium text-status-warning-text"
              >
                <AlertTriangle className="h-3 w-3" />
                Retenido en consolidación
              </span>
            )}
          </div>
          {pkg.skuItems.length === 0 ? (
            <span className="text-[10.5px] text-text-muted">Sin SKUs registrados</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {pkg.skuItems.map((item, i) => (
                <li key={`${pkg.id}-${item.sku}-${i}`} className="text-[10.5px] leading-snug text-text-secondary">
                  <span className="font-mono">{item.sku}</span> · {item.description} · x{item.quantity}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
