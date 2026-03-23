import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import type { ManifestPackage } from '@/hooks/pickup/useManifestOrders';

interface PackageRowProps {
  pkg: ManifestPackage;
  isVerified: boolean;
  onManualVerify: (label: string) => void;
}

export function PackageRow({ pkg, isVerified, onManualVerify }: PackageRowProps) {
  const skuCount = pkg.sku_items.length;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-surface-raised rounded-md text-sm">
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
  );
}
