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
      {/* `flex-wrap` (hotfix móvil 2026-09-10) — etiqueta, nº de bulto,
          conteo de SKUs, peso y los dos botones (`whitespace-nowrap` por el
          `buttonVariants` base) suman ~600px medidos en navegador, contra
          ~293px disponibles en un teléfono de 375px. Envolver es la única
          salida que no esconde datos: truncar la etiqueta sería mentir
          sobre la identidad del bulto que el operario tiene en la mano, y
          encoger los botones los deja ilegibles con guantes. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
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

        {/* Sin `flex-shrink-0` y con su propio `flex-wrap`: a 320px los dos
            botones juntos siguen sin caber en una línea aunque la fila ya
            envuelva, así que este grupo tiene que poder partirse también.
            `justify-end` mantiene el alineado a la derecha que daba
            `ml-auto` cuando cabía todo en una sola línea. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
              disabled={!isOnline}
              // spec-82 fase 2 revisión B1 — sin cola offline en esta
              // pantalla (eso es spec-81), un escaneo/verificación
              // manual offline queda pausado sólo en memoria y
              // desaparece sin rastro si la pestaña se cierra antes de
              // recuperar señal. Prometer el registro sería la misma
              // mentira que ManifestNotDownloadedNotice ya no dice.
              title={!isOnline ? 'Sin conexión — no se puede registrar el escaneo' : undefined}
              // Review de fase 5, M1 — el mock (`5d`) escribe "Marcar"; el
              // texto largo ("Marcar verificado") reabría la presión de
              // ancho que #772 arregló a 375px. `aria-label` se queda más
              // descriptivo porque, siendo explícito, reemplaza el texto
              // visible como nombre accesible — no cuesta ancho de pantalla.
              aria-label="Marcar verificado"
            >
              Marcar
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
                <th className="text-left font-medium py-0.5 pr-3">Descripción</th>
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
