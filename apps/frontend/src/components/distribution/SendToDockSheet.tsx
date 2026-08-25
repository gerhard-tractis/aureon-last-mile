'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DockCapacityBar } from './DockCapacityBar';
import type { SendToDockRequest } from './PendingMobileList';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 3 — `4e`, the "Enviar … a" sheet. Manual dock assignment
 * from the pendientes list: the suggested andén (by comuna) first, then
 * every other active andén, then Consolidación last with its retention
 * note.
 *
 * Decisión 6 — this whole sheet is gated by `canUse`
 * (`useManualDockAssignment.canUse`). Absent entirely when false, not
 * rendered-and-disabled: `warehouse_staff` must not even see that manual
 * assignment exists, or the physical andén scan stops reading as the
 * confirmation it is.
 */
export interface SendToDockSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: SendToDockRequest | null;
  activeZones: DockZoneRecord[];
  sectorizedCounts: Record<string, number>;
  canUse: boolean;
  /**
   * spec-68 Fase 4 review (finding #2) — true when `request` bundles
   * packages whose comunas resolve to MORE THAN ONE andén, so
   * `suggestedZone` reflects only the first matching package, not the
   * whole batch. Confirming as-is would silently sectorize every OTHER
   * package onto a zone that isn't actually theirs. Suppresses the
   * SUGERIDO badge and swaps the "sugerido {code} por comuna" subtitle
   * for an explicit warning — the caller must not tell the operator a
   * pre-selected zone is comuna-justified when it demonstrably isn't for
   * part of the batch. Defaults to `false`; the single-package (`4e`) and
   * single-comuna call sites are unaffected.
   */
  mixedComunaBatch?: boolean;
  /**
   * Fase 3 review (finding #4) — hands back the whole selected zone, not
   * just its id. Callers read `is_consolidation` straight off what the
   * user actually picked instead of re-looking it up in a filtered
   * `activeZones` array that can miss it (see finding #3: the suggested
   * zone can be inactive and absent from that array).
   */
  onConfirm: (zone: DockZoneRecord) => void;
}

export function SendToDockSheet({
  open,
  onOpenChange,
  request,
  activeZones,
  sectorizedCounts,
  canUse,
  mixedComunaBatch = false,
  onConfirm,
}: SendToDockSheetProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(
    request?.suggestedZone.id ?? null,
  );

  // Reset the selection to the suggested zone every time a new request comes
  // in — otherwise a stale pick from the previous package would silently
  // carry over.
  useEffect(() => {
    setSelectedZoneId(request?.suggestedZone.id ?? null);
  }, [request]);

  if (!canUse || !request) return null;

  const suggestedId = request.suggestedZone.id;
  // Finding #2 — every unmapped-comuna or future-dated package suggests
  // consolidación itself, so the suggested zone CAN already be
  // consolidación. Exclude suggestedId here the same way `andens` already
  // does, or consolidación would be appended a second time: duplicate key,
  // duplicate testid, both rows reading as selected.
  const consolidation = activeZones.find((z) => z.is_consolidation && z.id !== suggestedId);
  const andens = activeZones.filter((z) => !z.is_consolidation && z.id !== suggestedId);
  // Finding #3 — `request.suggestedZone` is a `DockZoneRecord` end to end
  // now (ZoneGroup.zone was mistyped as the narrower `DockZone` before),
  // so this fallback no longer widens to a union missing
  // capacity/operator_id. It stays reachable on purpose: determineDockZone
  // doesn't filter its consolidation fallback on `is_active`, so the
  // suggested zone can be inactive and absent from `activeZones` — the
  // sheet still needs to show it.
  const suggested = activeZones.find((z) => z.id === suggestedId) ?? request.suggestedZone;

  const orderedZones = [suggested, ...andens, ...(consolidation ? [consolidation] : [])];
  const selectedZone = orderedZones.find((z) => z.id === selectedZoneId) ?? suggested;

  const handleConfirm = () => {
    onConfirm(selectedZone);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-4 rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Enviar {request.code} a</SheetTitle>
          <SheetDescription>
            {mixedComunaBatch
              ? 'El lote abarca comunas distintas — revisa el andén de cada bulto antes de enviar.'
              : `${request.comunaName ? `${request.comunaName} · ` : ''}sugerido ${request.suggestedZone.code} por comuna`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {orderedZones.map((zone) => (
            <ZoneOption
              key={zone.id}
              zone={zone}
              isSuggested={zone.id === suggestedId && !mixedComunaBatch}
              isSelected={zone.id === selectedZone.id}
              count={sectorizedCounts[zone.id] ?? 0}
              onSelect={() => setSelectedZoneId(zone.id)}
            />
          ))}
        </div>

        <p className="text-[11.5px] leading-[1.4] text-text-secondary">
          El envío manual queda registrado con tu nombre y hora.
        </p>

        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[15px] font-medium text-text transition-colors active:bg-surface-raised"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            Enviar a {selectedZone.code}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ZoneOption({
  zone,
  isSuggested,
  isSelected,
  count,
  onSelect,
}: {
  zone: DockZoneRecord;
  isSuggested: boolean;
  isSelected: boolean;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`send-to-dock-option-${zone.id}`}
      onClick={onSelect}
      aria-pressed={isSelected}
      // Finding #7 (Fase 3 review) — isSelected is checked FIRST. Before,
      // isSuggested took precedence, so after picking a different andén
      // the suggested row kept its selected-looking accent fill and both
      // rows read as "chosen" at a glance. The SUGERIDO badge already
      // marks the suggestion independent of this — a lighter border here
      // is enough once it's no longer the pick.
      className={`flex min-h-[56px] flex-col gap-1.5 rounded-xl border-2 px-3.5 py-2.5 text-left transition-colors ${
        isSelected
          ? 'border-accent bg-surface-raised'
          : isSuggested
            ? 'border-accent/50 bg-surface'
            : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[14px] font-bold tracking-tight text-text">{zone.code}</span>
        <span className="truncate text-[12.5px] text-text-secondary">{zone.name}</span>
        {isSuggested && (
          <span className="ml-auto flex-none rounded-sm border border-accent bg-accent-muted px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-accent">
            SUGERIDO
          </span>
        )}
      </div>
      {zone.is_consolidation ? (
        <p className="text-[11.5px] text-text-secondary">Queda retenido hasta su fecha</p>
      ) : (
        <DockCapacityBar count={count} capacity={zone.capacity} />
      )}
    </button>
  );
}
