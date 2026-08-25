import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 4 review (finding 7) — was duplicated in
 * `ConsolidationMobileView.tsx` and `consolidacion/page.tsx`. The row's
 * SIN ANDÉN badge (rendered by the view) and the sheet's pre-selected
 * suggestion (resolved by the page) MUST agree, or a package the list
 * paints as unmapped can still get a comuna-justified suggestion in the
 * sheet — one shared implementation instead of two that can drift.
 *
 * Deliberately NOT `determineDockZone`: that function also gates on
 * delivery date (a future-dated package routes to consolidación
 * regardless of comuna). This is a comuna-only match, because
 * consolidación's retenido packages need "where would this go by comuna
 * alone", independent of why the package landed in consolidación.
 */
export function matchZoneByComuna(
  comunaId: string | null,
  zones: DockZoneRecord[],
): DockZoneRecord | null {
  if (!comunaId) return null;
  return (
    zones.find((z) => !z.is_consolidation && z.is_active && z.comunas.some((c) => c.id === comunaId)) ?? null
  );
}
