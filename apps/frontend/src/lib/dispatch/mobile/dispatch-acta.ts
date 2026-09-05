// apps/frontend/src/lib/dispatch/mobile/dispatch-acta.ts
//
// spec-77 Fase 4 — `2l`, "Ruta despachada". Pure copy/formatting over data
// the caller already has — no fetch here (Lecciones aplicadas: a fixture
// must only carry data the real hook can actually produce).
//
// Item 16's "4 cifras": paradas despachadas, paquetes despachados (both
// from the dispatch endpoint's own response — spec-79), paquetes que
// quedan en el andén and órdenes partidas (both from the SEAL/force
// outcome — `forced.released_count` + `forced.split_count` /
// `forced.split_order_ids.length` — never re-derived from `packages`
// client-side, per this task's own brief: "get that count from the
// seal/force outcome, not by inference").

export interface ActaFiguresInput {
  stopsCount: number;
  packagesDispatched: number;
  packagesLeftAtDock: number;
  splitOrdersCount: number;
}

export interface ActaFigure {
  testId: string;
  label: string;
  value: number;
}

export function buildActaFigures(input: ActaFiguresInput): ActaFigure[] {
  return [
    { testId: 'acta-paradas', label: 'Paradas despachadas', value: input.stopsCount },
    { testId: 'acta-paquetes', label: 'Paquetes despachados', value: input.packagesDispatched },
    { testId: 'acta-anden', label: 'Paquetes en el andén', value: input.packagesLeftAtDock },
    { testId: 'acta-partidas', label: 'Órdenes partidas', value: input.splitOrdersCount },
  ];
}

/**
 * Item 16 — "lo que queda en el andén". The H3-era mock claimed the
 * leftover boxes stay `asignado`; spec-77 decision 9 / `force-seal-release.ts`
 * / `force-seal-split.ts` actually revert them to `sectorizado` (available
 * for another route, not still merely "assigned"). This must say
 * `sectorizado`, never `asignado` — the false claim this task was warned
 * about.
 */
export function dockLeftLine(packagesLeftAtDock: number, splitOrdersCount: number): string {
  if (packagesLeftAtDock === 0) {
    return 'No quedaron paquetes en el andén de esta carga.';
  }
  const splitLine = splitOrdersCount > 0
    ? ` (${splitOrdersCount} ${splitOrdersCount === 1 ? 'orden partida' : 'órdenes partidas'})`
    : '';
  return `${packagesLeftAtDock} paquetes vuelven a sectorizado y quedan disponibles para otra ruta hoy${splitLine}.`;
}

export interface NextLoad {
  id: string;
  code: string;
  comuna: string | null;
}

/**
 * Item 17 — a concrete next load, or nothing. Never a generic "volver al
 * inicio" in place of an unknown route (decision 7).
 */
export function nextLoadLine(next: NextLoad | null): string | null {
  if (!next) return null;
  return next.comuna ? `${next.code} · ${next.comuna}` : next.code;
}
