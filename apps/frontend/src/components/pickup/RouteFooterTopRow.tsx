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
 *
 * QA 2026-09-11 — el mock 5c dibuja los cuatro controles en una fila sobre
 * un artboard de ~472px, no sobre un teléfono real: a 390px la fila
 * desbordaba (el botón "+" quedaba 108px fuera de pantalla e inalcanzable).
 * Dos ajustes, ninguno esconde un control: "Digitalizar manifiesto" pasa a
 * icon-only (ancho fijo 44px, igual que "Buscar" y "+", ver
 * DigitalizeManifestTrigger), y "Ver manifiesto(s)" se trunca (`truncate
 * min-w-0`) en vez de forzar el ancho de la fila. El orden se mantiene.
 */
interface RouteFooterTopRowProps {
  manifestsCount: number;
  showAll: boolean;
  /** id del panel de la lista, para `aria-controls` — sólo se pasa un
   *  idref real cuando el panel existe en el DOM (ver page.tsx). */
  manifestListPanelId: string | undefined;
  onToggleShowAll: () => void;
  searchOpen: boolean;
  /** L4, review — id del `<input type="search">` de RouteManifestPanel,
   *  para el `aria-controls` de este botón. Mismo patrón que
   *  `manifestListPanelId`: sólo un idref real cuando el campo existe en
   *  el DOM (`searchOpen`), nunca colgante. */
  searchInputId: string | undefined;
  onToggleSearch: () => void;
  onOpenAdd: () => void;
}

export function RouteFooterTopRow({
  manifestsCount,
  showAll,
  manifestListPanelId,
  onToggleShowAll,
  searchOpen,
  searchInputId,
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
        aria-controls={searchInputId}
        onClick={onToggleSearch}
      >
        <Search className="h-4 w-4" />
      </Button>
      {manifestsCount > 0 && (
        <Button
          type="button"
          variant="secondary"
          className="flex-1 min-w-0 truncate min-h-[44px]"
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
          DigitalizeManifestTrigger.tsx. Icon-only aquí (QA 2026-09-11): con
          label de texto competía por ancho con "Ver manifiesto(s)" y
          empujaba "+" fuera de la pantalla a 390px. */}
      <DigitalizeManifestTrigger iconOnly />
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
