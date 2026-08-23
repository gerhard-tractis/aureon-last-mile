'use client';

/**
 * OrdersPageHeader — the identity block above the tabs on `/app/orders`
 * (spec-65, mock `3a`). Split out of `page.tsx` to keep that file under the
 * project's 300-line limit.
 *
 * Two export-shaped actions live here on purpose, both calling `ordersToCsv`
 * but over different row sets — "Exportar CSV" (this component) exports the
 * *current filtered view*; `OrdersBulkBar`'s "Exportar" exports only the
 * *selected* rows. The `title` attributes spell out the difference so
 * nobody clicks the wrong one expecting the other's behaviour.
 */

import { Download, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OrdersPageHeaderProps {
  totalCount: number;
  onExportCurrentView: () => void;
  onCopyShareableUrl: () => void;
}

export function OrdersPageHeader({
  totalCount,
  onExportCurrentView,
  onCopyShareableUrl,
}: OrdersPageHeaderProps) {
  return (
    <div className="flex flex-none items-center justify-between border-b border-border bg-surface px-6 py-4">
      <div>
        <h1 className="font-heading text-lg font-semibold leading-none text-text">Pedidos</h1>
        <p className="mt-1 text-[11px] text-text-secondary">
          Toda la operación en una sola tabla · {totalCount} pedidos
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          title="Exporta los pedidos de la vista actual cargada en pantalla — usa Exportar en la barra de selección para exportar solo los pedidos marcados"
          onClick={onExportCurrentView}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Copia el enlace de esta vista — no guarda nada, solo comparte la URL actual"
          onClick={onCopyShareableUrl}
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Guardar vista
        </Button>
      </div>
    </div>
  );
}
