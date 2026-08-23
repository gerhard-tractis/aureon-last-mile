'use client';

/**
 * OrdersPageHeader — the identity block above the tabs on `/app/orders`
 * (spec-65, mock `3a`). Split out of `page.tsx` to keep that file under the
 * project's 300-line limit.
 *
 * Controller review, round 3: the export button used to read "Exportar
 * CSV" while silently only covering the loaded page — a `12.847 pedidos`
 * subtitle next to a button that exports 50 rows is a trust bug a user
 * discovers only after opening the file, by which point they may already
 * have sent it on. The label now names both what it does and how much:
 * "Exportar página (N)" with the live `pageRowCount`, which also updates
 * as the user pages, making the scope self-evident rather than asserted
 * in a tooltip nobody reads. `OrdersBulkBar`'s own export got the same
 * treatment ("Exportar seleccionados (N)") for the same reason. A
 * full-dataset export (every row of `totalCount`, not just this page) is
 * out of scope — see `_page-helpers.ts` / the Task 6 report for why and
 * what it would take.
 */

import { Download, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OrdersPageHeaderProps {
  totalCount: number;
  /** Rows actually loaded for the current page — what "Exportar página" covers. */
  pageRowCount: number;
  onExportCurrentPage: () => void;
  onCopyShareableUrl: () => void;
}

export function OrdersPageHeader({
  totalCount,
  pageRowCount,
  onExportCurrentPage,
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
          title="Exporta solo los pedidos cargados en esta página — no la vista filtrada completa"
          onClick={onExportCurrentPage}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar página ({pageRowCount})
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
