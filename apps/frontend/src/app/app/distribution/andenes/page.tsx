'use client';

import { useRouter } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { DockListMobile } from '@/components/distribution/DockListMobile';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { getDockCapacityStatus } from '@/lib/distribution/dock-capacity';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';
import { useOperatorId } from '@/hooks/useOperatorId';

/**
 * spec-68 Fase 6 (Decisión 3) — `/app/distribution/andenes`. The list
 * `4c`'s PROCESOS DE LA NAVE row promises and the canvas never drew.
 *
 * NOT immersive (Decisión 2) — no fixed footer, so it does not join
 * `MOBILE_IMMERSIVE_PREFIXES`; the global `MobileTabBar` stays.
 *
 * No injectable props needed for testing (no clock, no seam like
 * `ConsolidationPageContent`'s `now`), so — unlike `/consolidacion` — the
 * page owns its data-fetching directly rather than delegating to a
 * `*PageContent` component. It still exports only the default page
 * function and nothing else, per the Next Page-contract rule.
 *
 * Fase 6 review (finding #1) — `useDockZones` is `enabled: !!operatorId`,
 * and `GlobalContext` initialises `operatorId` to `null` while `AppLayout`
 * renders children unconditionally. React Query v5's `isLoading` is
 * `isPending && isFetching`, and a DISABLED query reports `isFetching:
 * false` — so on every cold load the old `zonesLoading` gate read false
 * too, rendering `DockListMobile` on the `zones = []` default and
 * flashing "Sin andenes configurados" at a crew standing in front of a
 * fully configured warehouse. Worse, that state was PERMANENT on a real
 * query failure (offline warehouse, RLS): `isLoading` false, `data`
 * undefined forever, same empty screen. "No hay andenes" and "no pude
 * cargar los andenes" are different facts and must not share a screen —
 * `isError` is checked FIRST and returns a distinct error state; loading
 * is then gated on `!operatorId || !zones` itself (the same pattern
 * `quicksort/page.tsx` already uses), not on `isLoading`.
 *
 * spec-96 Fase 8 (`4l`) — the subtitle adds the unconfigured-capacity count
 * (`4l`'s "N sin abrir") alongside the active count, both derived from the
 * same `zones` this route already fetches — no new query. `4l`'s subtitle
 * also carries a warehouse name ("Nave Quilicura"); this route has no
 * source for it (no code anywhere renders it yet — Fase 6, `4c`, is the
 * phase that would wire it), so it stays out rather than being hardcoded.
 * `unconfigured` reads `getDockCapacityStatus(...).configured` rather than
 * a hand-rolled `capacity > 0` — review round 1, finding #4.
 *
 * The footer banner over comunas falling to consolidation (review round 1,
 * finding #1) does NOT read `get_unmatched_comunas` — that RPC's predicate
 * (`comuna_id IS NULL`) and `determineDockZone`'s `flagged`
 * (`comunaId !== null`) are exact complements, so the two counts can never
 * overlap; wiring the tile's source here would show a banner that can
 * never fire while real "known comuna, no andén covers it" packages sit in
 * consolidation. It also groups by the raw string, so two spellings of one
 * comuna would double-count.
 *
 * Instead this recomputes `determineDockZone(...).flagged` per order over
 * `usePendingSectorization`'s data — the same per-order recompute
 * `PendingMobileList.tsx` already does and for the same reason (the
 * bucket-level `matchResult.flagged` mixes `future_date` and `unmapped` in
 * the consolidation bucket) — and counts DISTINCT comuna names among the
 * flagged orders, not RPC rows, so two spellings of one comuna count once.
 *
 * `usePendingSectorization` IS a new fetch on this route: it pulls every
 * `en_bodega` package for the operator to compute the buckets. Its cache
 * key is shared with `/pendientes` and quicksort, so on the ordinary
 * navigation path (`4c` → andenes) the data is usually already warm — but
 * cold, or at production scale (~61k packages/~112k dispatches per
 * `project_prod_data_scale`), this is not free. Declared, not hidden.
 */
function countUnassignedComunas(
  groups: ZoneGroup[],
  zones: DockZoneRecord[],
  today: string,
): number {
  if (!zones.some((z) => z.is_consolidation)) return 0;
  const comunas = new Set<string>();
  for (const group of groups) {
    for (const order of group.orders) {
      const rep = order.packages[0];
      if (!rep) continue;
      let flagged: boolean;
      try {
        flagged = determineDockZone(
          { comunaId: rep.comunaId, delivery_date: rep.delivery_date },
          zones,
          today,
        ).flagged;
      } catch {
        continue;
      }
      if (flagged && order.comunaName) {
        comunas.add(order.comunaName);
      }
    }
  }
  return comunas.size;
}

export default function AndenesPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: zones, isError: zonesIsError } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);
  const { data: pendingGroups = [] } = usePendingSectorization(operatorId);

  const goBack = () => router.push('/app/distribution');

  if (zonesIsError) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Andenes" onBack={goBack} />
        <EmptyState
          icon={WifiOff}
          title="No pudimos cargar los andenes"
          description="Revisa tu conexión e intenta de nuevo. Los andenes reales no cambiaron — es la pantalla la que no pudo leerlos."
        />
      </div>
    );
  }

  if (!operatorId || !zones) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Andenes" onBack={goBack} />
        <Skeleton data-testid="andenes-skeleton" className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const activeZones = zones.filter((z) => z.is_active);
  const activeCount = activeZones.length;
  // Review round 1, finding #4 — was a hand-rolled `capacity > 0` check,
  // duplicating what getDockCapacityStatus already floors to `configured`.
  const unconfiguredCount = activeZones.filter(
    (z) => !getDockCapacityStatus(0, z.capacity).configured,
  ).length;
  const subtitle = [
    `${activeCount} ${activeCount === 1 ? 'activo' : 'activos'}`,
    unconfiguredCount > 0 ? `${unconfiguredCount} sin abrir` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const today = todayISOInTimezone();
  const unassignedComunasCount = countUnassignedComunas(pendingGroups, zones, today);

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
      <DistributionMobileHeader
        variant="titled"
        title="Andenes"
        subtitle={subtitle}
        onBack={goBack}
      />
      {/* Review round 1, finding #2 — a plain-text subtitle assertion
          (`/1 sin abrir/`) passed even with the count hardcoded, because
          the regex matched a substring of a different number. This mirror
          exists only so the wiring has a behavioural anchor
          (`textContent === '<n>'`) that a wrong-but-plausible value cannot
          slip past — `DistributionMobileHeader` renders the subtitle as a
          plain string with no seam of its own to hook into, and it is not
          this phase's file to add one to. */}
      <span data-testid="andenes-unconfigured-count" className="sr-only">
        {unconfiguredCount}
      </span>

      {/* `4l:1179-1243` — the row list scrolls; the header and the
          comunas-to-consolidación banner below it do not. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <DockListMobile zones={zones} sectorizedCounts={sectorizedCounts} />
      </div>

      {unassignedComunasCount > 0 && (
        <div
          data-testid="unassigned-comunas-banner"
          className="flex flex-none items-center gap-2.5 border-t border-border bg-surface px-3.5 py-2.5"
        >
          <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg border border-status-warning-border bg-surface font-mono text-xs font-bold text-status-warning-text">
            !
          </span>
          <span className="text-[11.5px] font-medium text-status-warning-text">
            <span data-testid="unassigned-comunas-count">{unassignedComunasCount}</span>{' '}
            {unassignedComunasCount === 1
              ? 'comuna sin andén asignado cae a consolidación'
              : 'comunas sin andén asignado caen a consolidación'}
          </span>
        </div>
      )}
    </div>
  );
}
