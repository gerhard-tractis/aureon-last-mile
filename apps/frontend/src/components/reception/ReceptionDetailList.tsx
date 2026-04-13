'use client';

import { useMemo } from 'react';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ReceptionPackageItem {
  id: string;
  label: string;
  orderNumber: string;
  received: boolean;
}

interface ReceptionDetailListProps {
  packages: ReceptionPackageItem[];
  onManualReceive: (label: string) => void;
}

export function ReceptionDetailList({ packages, onManualReceive }: ReceptionDetailListProps) {
  const sorted = useMemo(() => {
    return [...packages].sort((a, b) => {
      // Received first, then pending
      if (a.received && !b.received) return -1;
      if (!a.received && b.received) return 1;
      return 0;
    });
  }, [packages]);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-text-muted text-center py-4">
        No hay paquetes en esta carga
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {sorted.map((pkg) => (
        <div
          key={pkg.id}
          className={`flex items-center gap-3 p-2 rounded-md ${
            pkg.received ? 'bg-status-success-bg' : 'bg-surface-raised'
          }`}
        >
          {pkg.received ? (
            <CheckCircle className="h-5 w-5 text-status-success flex-shrink-0" data-testid="received-icon" />
          ) : null}
          <div className="flex-1 min-w-0">
            <span
              data-testid="package-label"
              className="font-mono text-sm block truncate"
            >
              {pkg.label}
            </span>
            <span className="text-xs text-text-secondary">{pkg.orderNumber}</span>
          </div>
          <div className="flex-shrink-0">
            {pkg.received ? (
              <span className="text-xs font-medium text-status-success">Recibido</span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onManualReceive(pkg.label)}
                aria-label="Marcar Recibido"
              >
                Marcar Recibido
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
