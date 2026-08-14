'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, ChevronDown, ChevronRight, PackagePlus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ManifestPackage } from '@/hooks/pickup/useManifestOrders';
import { useExpandCarton } from '@/hooks/pickup/useExpandCarton';
import { ExpandCartonSheet } from './ExpandCartonSheet';

interface PackageRowProps {
  pkg: ManifestPackage;
  isVerified: boolean;
  onManualVerify: (label: string) => void;
  /**
   * How many boxes already exist in this carton's family (parent + any
   * previously minted siblings). Only used to preview the labels the
   * "Agregar bultos" sheet is about to create. Defaults to 1 (just the
   * parent) for callers that predate spec-55.
   */
  existingBoxCount?: number;
}

export function PackageRow({ pkg, isVerified, onManualVerify, existingBoxCount = 1 }: PackageRowProps) {
  const skuCount = pkg.sku_items.length;
  const [expanded, setExpanded] = useState(false);
  const [expandSheetOpen, setExpandSheetOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const expandCarton = useExpandCarton();

  // spec-55 — expansion mints server-side identifiers that must be unique;
  // inventing them offline risks collisions, so the button is disabled
  // offline with an explicit message.
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleConfirmExpand = (additionalBoxes: number, reason: string) => {
    expandCarton.mutate(
      { packageId: pkg.id, additionalBoxes, reason },
      {
        onSuccess: (created) => {
          toast.success(`${created.length} bulto(s) agregado(s) a ${pkg.label}`);
          setExpandSheetOpen(false);
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'No se pudo agregar bultos');
        },
      }
    );
  };

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

        {pkg.is_generated_label && (
          <span
            data-testid="generated-badge"
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-muted/40 text-accent flex-shrink-0"
          >
            <Sparkles className="h-3 w-3" />
            Aureon
          </span>
        )}

        {pkg.package_number && (
          <span className="text-text-secondary flex-shrink-0">{pkg.package_number}</span>
        )}

        <span className="text-text-secondary">
          {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
        </span>

        {pkg.declared_weight_kg != null && (
          <span className="text-text-secondary">{pkg.declared_weight_kg} kg</span>
        )}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {!pkg.is_generated_label && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpandSheetOpen(true)}
              disabled={!isOnline}
              title={!isOnline ? 'Sin conexión — la expansión requiere estar en línea' : undefined}
              aria-label="Agregar bultos"
            >
              <PackagePlus className="h-4 w-4 mr-1" />
              Agregar bultos
            </Button>
          )}

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

      {!pkg.is_generated_label && (
        <ExpandCartonSheet
          open={expandSheetOpen}
          onOpenChange={setExpandSheetOpen}
          parentLabel={pkg.label}
          existingBoxCount={existingBoxCount}
          onConfirm={handleConfirmExpand}
          isSubmitting={expandCarton.isPending}
        />
      )}

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
