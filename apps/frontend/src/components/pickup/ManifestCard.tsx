'use client';

import { MapPin, Package, PlayCircle, Printer, ShoppingCart, Truck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function formatPrintedAt(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ManifestCardProps {
  externalLoadId: string;
  retailerName: string | null;
  pickupPoint?: string | null;
  orderCount: number;
  packageCount: number;
  /** Count of packages already scanned/verified for this load (Activos tab only). */
  verifiedCount?: number;
  createdAt?: string;
  completedAt?: string;
  /**
   * If true, render a "Pickup confirmado" badge below the main row so
   * the operator can recognise at a glance that this manifest is already
   * handed off and tapping it will show the QR (not re-enter the scan flow).
   */
  inTransit?: boolean;
  interactive?: boolean;
  onClick: () => void;
  /** spec-53 — PACKAGE_LABELS module gate. Button is absent entirely when false. */
  labelsEnabled?: boolean;
  /** NULL when no manifests row exists yet for this load — nothing to print. */
  manifestId?: string | null;
  labelsPrintedAt?: string | null;
  labelsPrintedByName?: string | null;
  onPrintLabels?: () => void;
}

export function ManifestCard({
  externalLoadId,
  retailerName,
  pickupPoint,
  orderCount,
  packageCount,
  verifiedCount = 0,
  createdAt,
  completedAt,
  inTransit = false,
  interactive = true,
  onClick,
  labelsEnabled = false,
  manifestId = null,
  labelsPrintedAt = null,
  labelsPrintedByName = null,
  onPrintLabels,
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
      {pickupPoint && (
        <div className="flex items-center gap-1 text-xs text-text-secondary mt-1.5 min-w-0">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{pickupPoint}</span>
        </div>
      )}
      {createdAt && (
        <p className="text-xs text-text-muted mt-2">
          Creado el {new Date(createdAt).toLocaleDateString()}
        </p>
      )}
      {completedAt && (
        <p className="text-xs text-text-muted mt-2">
          Completado el {new Date(completedAt).toLocaleDateString()}
        </p>
      )}
      {labelsEnabled && manifestId && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {labelsPrintedAt ? (
            <p className="text-xs text-text-muted">
              Etiquetas impresas — {formatPrintedAt(labelsPrintedAt)}
              {labelsPrintedByName ? `, por ${labelsPrintedByName}` : ''}
            </p>
          ) : (
            <span />
          )}
          {labelsPrintedAt ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Reimprimir etiquetas
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Reimprimir etiquetas?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Última impresión: {formatPrintedAt(labelsPrintedAt)}
                    {labelsPrintedByName ? `, por ${labelsPrintedByName}` : ''}.
                    Se abrirá una nueva pestaña con la hoja de impresión completa.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.stopPropagation(); onPrintLabels?.(); }}
                  >
                    Reimprimir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPrintLabels?.(); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir etiquetas
            </button>
          )}
        </div>
      )}
      {inTransit && (
        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
          <Truck className="h-3 w-3" />
          <span>Pickup confirmado</span>
        </div>
      )}
      {!inTransit && verifiedCount > 0 && (
        <div
          data-testid="in-progress-badge"
          className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-status-warning-bg px-2 py-0.5 text-xs font-medium text-status-warning"
        >
          <PlayCircle className="h-3 w-3" />
          <span>
            En progreso · {verifiedCount}/{packageCount}
          </span>
        </div>
      )}
    </div>
  );
}
