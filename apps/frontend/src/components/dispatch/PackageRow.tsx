import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import type { BadgeVariant } from '@/components/StatusBadge';
import type { RoutePackage } from '@/lib/dispatch/types';

interface Props {
  index: number;
  pkg: RoutePackage;
  onRemove: (dispatchId: string) => void;
}

const PACKAGE_STATUS_CONFIG: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  ingresado: { label: 'Ingresado', variant: 'neutral' },
  verificado: { label: 'Verificado', variant: 'info' },
  en_bodega: { label: 'En bodega', variant: 'neutral' },
  asignado: { label: 'Asignado', variant: 'info' },
  en_carga: { label: 'En carga', variant: 'warning' },
  listo_para_despacho: { label: 'Listo', variant: 'success' },
  en_ruta: { label: 'En ruta', variant: 'warning' },
  entregado: { label: 'Entregado', variant: 'success' },
  cancelado: { label: 'Cancelado', variant: 'error' },
};

export function PackageRow({ index, pkg, onRemove }: Props) {
  const statusConfig = PACKAGE_STATUS_CONFIG[pkg.package_status];

  return (
    <div className="flex items-center gap-3.5 bg-surface border border-border rounded-[10px] px-3.5 min-h-[60px] mb-2">
      <span className="font-mono text-[11px] text-text-muted w-5.5 text-right shrink-0">
        {index}
      </span>
      <div className="flex-1 min-w-0 py-2">
        <div className="font-mono text-[11px] text-accent">
          {pkg.order_number}
        </div>
        <div className="text-sm font-semibold text-text">
          {pkg.contact_name ?? '—'}
        </div>
        <div className="text-xs text-text-muted truncate">
          {pkg.contact_address ?? '—'}
        </div>
      </div>
      <StatusBadge
        status={pkg.package_status}
        variant={statusConfig?.variant}
        size="sm"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(pkg.dispatch_id)}
        aria-label="Eliminar paquete"
        className="text-text-muted shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
