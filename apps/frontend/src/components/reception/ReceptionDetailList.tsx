'use client';

import { useMemo } from 'react';
import { CheckCircle, Circle } from 'lucide-react';

export interface ReceptionPackageItem {
  id: string;
  label: string;
  orderNumber: string;
  received: boolean;
}

interface ReceptionDetailListProps {
  packages: ReceptionPackageItem[];
}

export function ReceptionDetailList({ packages }: ReceptionDetailListProps) {
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
      <p className="text-sm text-gray-400 text-center py-4">
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
            pkg.received ? 'bg-green-50' : 'bg-gray-50'
          }`}
        >
          {pkg.received ? (
            <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
          ) : (
            <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <span
              data-testid="package-label"
              className="font-mono text-sm block truncate"
            >
              {pkg.label}
            </span>
            <span className="text-xs text-gray-500">{pkg.orderNumber}</span>
          </div>
          <span
            className={`text-xs font-medium ${
              pkg.received ? 'text-green-600' : 'text-gray-400'
            }`}
          >
            {pkg.received ? 'Recibido' : 'Pendiente'}
          </span>
        </div>
      ))}
    </div>
  );
}
