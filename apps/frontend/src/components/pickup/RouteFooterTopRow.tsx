'use client';

import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DigitalizeManifestTrigger } from './DigitalizeManifestTrigger';

/**
 * spec-95 fase 2 (mock 5c) — fila superior del pie de dos filas: Buscar, el
 * toggle de manifiestos, Digitalizar manifiesto y +. Extraído de
 * `route/active/page.tsx` para mantenerlo bajo 300 líneas (mismo patrón de
 * split por tamaño que RouteManifestPanel.tsx / RouteManifestCard.tsx, fase
 * 1). Antes de esta fase, el toggle y "+" vivían en su propia fila dentro
 * del cuerpo (no en el pie fijo) y "Digitalizar manifiesto" era un bloque
 * inline aparte debajo de todo — spec-82 fase 1 lo dejó así a propósito
 * para minimizar el diff; esta fase cierra ese punto porque ya toca la
 * barra.
 */
interface RouteFooterTopRowProps {
  manifestsCount: number;
  showAll: boolean;
  /** id del panel de la lista, para `aria-controls` — sólo se pasa un
   *  idref real cuando el panel existe en el DOM (ver page.tsx). */
  manifestListPanelId: string | undefined;
  onToggleShowAll: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onOpenAdd: () => void;
}

export function RouteFooterTopRow({
  manifestsCount,
  showAll,
  manifestListPanelId,
  onToggleShowAll,
  searchOpen,
  onToggleSearch,
  onOpenAdd,
}: RouteFooterTopRowProps) {
  return (
    <div className="flex items-center gap-2" data-testid="route-footer-top-row">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="min-h-[44px] min-w-[44px]"
        aria-label="Buscar carga"
        aria-expanded={searchOpen}
        onClick={onToggleSearch}
      >
        <Search className="h-4 w-4" />
      </Button>
      {manifestsCount > 0 && (
        <Button
          type="button"
          variant="secondary"
          className="flex-1 min-h-[44px]"
          aria-expanded={showAll}
          aria-controls={manifestListPanelId}
          onClick={onToggleShowAll}
        >
          {showAll
            ? 'Ocultar manifiestos'
            : manifestsCount === 1
              ? 'Ver el manifiesto'
              : `Ver los ${manifestsCount} manifiestos`}
        </Button>
      )}
      {/* spec-82 phase 1 (mock 5c) — precarga/digitalización de un
          manifiesto nuevo directamente desde la ruta activa, sin volver a
          la pantalla de escritorio. Reusa el mismo flujo OCR que "Nuevo
          Manifiesto" ya usa en /app/pickup (spec-47); ver
          DigitalizeManifestTrigger.tsx. */}
      <DigitalizeManifestTrigger className="flex-1 min-h-[44px] gap-2" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="min-h-[44px] min-w-[44px]"
        aria-label="Agregar manifiesto"
        data-testid="open-add-manifest"
        onClick={onOpenAdd}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
