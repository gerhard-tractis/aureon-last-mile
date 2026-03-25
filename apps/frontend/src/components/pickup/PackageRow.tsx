'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ManifestPackage } from '@/hooks/pickup/useManifestOrders';

interface PackageRowProps {
  pkg: ManifestPackage;
  isVerified: boolean;
  onManualVerify: (label: string) => void;
}

export function PackageRow({ pkg, isVerified, onManualVerify }: PackageRowProps) {
  const skuCount = pkg.sku_items.length;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-raised rounded-md text-sm">
      <div className="flex items-center gap-3 px-3 py-2">
        {skuCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 text-text-secondary hover:text-text"
            aria-expanded={expanded}
            aria-label={expanded ? 'Ocultar SKUs' : 'Ver SKUs'}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        <span className="font-mono font-medium flex-shrink-0">{pkg.label}</span>

        {pkg.package_number && (
          <span className="text-text-secondary flex-shrink-0">{pkg.package_number}</span>
        )}

        <span className="text-text-secondary">
          {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
        </span>

        {pkg.declared_weight_kg != null && (
          <span className="text-text-secondary">{pkg.declared_weight_kg} kg</span>
        )}

        <div className="ml-auto flex-shrink-0">
          {isVerified ? (
            <CheckCircle className="h-5 w-5 text-status-success" data-testid="verified-icon" />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onManualVerify(pkg.label)}
              aria-label="Mark verified"
            >
              Mark Verified
            </Button>
          )}
        </div>
      </div>

      {expanded && skuCount > 0 && (
        <div className="px-3 pb-2 pt-0 ml-7 border-t border-border/50">
          <table className="w-full text-xs mt-1.5" data-testid="sku-table">
            <thead>
              <tr className="text-text-secondary">
                <th className="text-left font-medium py-0.5 pr-3">SKU</th>
                <th className="text-left font-medium py-0.5 pr-3">Descripcion</th>
                <th className="text-right font-medium py-0.5">Cant.</th>
              </tr>
            </thead>
            <tbody>
              {pkg.sku_items.map((item, i) => (
                <tr key={`${item.sku}-${i}`} className="text-text">
                  <td className="font-mono py-0.5 pr-3">{item.sku}</td>
                  <td className="py-0.5 pr-3">{item.description}</td>
                  <td className="text-right py-0.5">{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
