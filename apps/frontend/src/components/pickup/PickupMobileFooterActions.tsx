'use client';

import { Search, X } from 'lucide-react';

/**
 * spec-54 3h redesign — the mock's footer row has two buttons, "Buscar
 * carga" and "Reportar problema". Only "Buscar carga" is built:
 *
 *   - "Buscar carga" — no dedicated screen exists for it, but the desktop
 *     already has a real, working search (`PickupDesktopView`'s
 *     `searchTerm`/`matchesSearchTerm`) over a different, larger dataset
 *     (all pending/in-transit/completed tabs). Reusing that exact state
 *     into the mobile "today's route" screen would search the wrong
 *     dataset. Instead this button reveals a small inline filter INSIDE
 *     `ActiveRouteBody` (see PickupMobileView) that narrows the existing
 *     remaining/completed lists in place — the header, KPI tiles and hero
 *     card stay on screen. It never swaps out the whole screen for a bare
 *     input; that read as a mode switch the artboard doesn't show.
 *     This button itself always stays visible (it is rendered by the
 *     parent regardless of `searchOpen`), so the "Cerrar búsqueda" state
 *     below is genuinely reachable, not dead code.
 *   - "Reportar problema" — grepped the codebase for any pickup
 *     issue/incident flow (route, hook, RPC) and found none; the closest
 *     hit is `ReturnReceptionSession`'s unrelated returns-reception report.
 *     Wiring the button to nothing would be a dead control, so it is
 *     omitted rather than built.
 */
export interface PickupMobileFooterActionsProps {
  searchOpen: boolean;
  onToggleSearch: () => void;
}

export function PickupMobileFooterActions({
  searchOpen,
  onToggleSearch,
}: PickupMobileFooterActionsProps) {
  return (
    <button
      type="button"
      onClick={onToggleSearch}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-surface text-[13.5px] font-medium text-text transition-colors active:bg-surface-raised"
    >
      {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      {searchOpen ? 'Cerrar búsqueda' : 'Buscar carga'}
    </button>
  );
}
