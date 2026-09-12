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
 *
 * Review round 3 — that hook reports `truncated` rather than throwing at
 * PostgREST's row cap (see its own doc for why throwing broke its other
 * three consumers). This page is the one place that DOES need to know:
 * `unassignedComunasCount` under a truncated fetch is a lower bound, not
 * the truth, so it renders as an explicit "cannot be counted" state
 * (`unassigned-comunas-indeterminate`) rather than either the real banner
 * or silence — silence there is indistinguishable from "confirmed zero",
 * which is the exact bug this recompute exists to fix.
 */
function countUnassignedComunas(
  groups: ZoneGroup[],
  zones: DockZoneRecord[],
  today: string,
): number {
  // Review round 2 — the explicit "no consolidation zone" guard that used
  // to live here was redundant: `determineDockZone` throws exactly that
  // case, and the `catch` below already turns it into "skip this order",
  // which is the same net effect (zero flagged orders) without a second
  // place asserting it.
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
  const {
    data: pendingGroups = [],
    isLoading: pendingLoading,
    truncated: pendingTruncated,
  } = usePendingSectorization(operatorId);

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
  // Review round 2, finding #3 — the consolidation zone carries
  // `capacity: null` BY DESIGN (`Configuración de Andenes` has no `Editar`
  // action for it — see the spec's prerequisite section); counting it here
  // made the subtitle read "1 sin abrir" forever, on every operator, even
  // with all real andenes configured. `4l:1174`'s "sin abrir" means a real
  // andén missing its capacity, not the holding zone where capacity is
  // meaningless.
  const unconfiguredCount = activeZones.filter(
    (z) => !z.is_consolidation && !getDockCapacityStatus(0, z.capacity).configured,
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
    // Review round 2, finding #2 — without `flex-1` here this root sizes
    // to content inside `<main>` (itself `flex min-h-0 flex-1 flex-col`,
    // per AppLayout.tsx), so the `flex-1 overflow-y-auto` list below never
    // had a bounded height to scroll *within* and the banner was an
    // ordinary in-flow block, not the fixed footer `4l:1244-1250` draws —
    // invisible with 6 docks, below the fold with 12.
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-[22px]">
      <DistributionMobileHeader
        variant="titled"
        title="Andenes"
        subtitle={subtitle}
        onBack={goBack}
      />

      {/* `4l:1179-1243` — the row list scrolls; the header and the
          comunas-to-consolidación banner below it do not. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <DockListMobile zones={zones} sectorizedCounts={sectorizedCounts} />
      </div>

      {/* Review round 2, finding #6 / round 3 — three states, each its own
          testid so none reads as another: (1) still loading — between
          `zones` resolving and this query settling,
          `unassignedComunasCount` reads 0 exactly like "confirmed none
          flagged" would; (2) truncated — `usePendingSectorization` hit
          PostgREST's row cap, so the count is a lower bound, not the
          truth, and must read as "unknown", never as a real zero (review
          round 3: this used to throw here — see the hook's doc for why
          that broke the other three consumers); (3) settled and complete
          — the real count, banner only when it's nonzero. */}
      {pendingLoading ? (
        <div
          data-testid="unassigned-comunas-checking"
          className="flex-none px-5 py-2 text-[10.5px] text-text-muted"
        >
          Comprobando comunas sin andén…
        </div>
      ) : pendingTruncated ? (
        <div
          data-testid="unassigned-comunas-indeterminate"
          className="flex flex-none flex-col gap-2 border-t border-border bg-surface px-5 py-3.5"
        >
          <div className="flex items-center gap-2.5 rounded-[11px] border border-border-strong bg-surface-raised px-3.5 py-2.5">
            <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-lg border border-border-strong bg-surface font-mono text-xs font-bold text-text-secondary">
              ?
            </span>
            <span className="text-[11.5px] font-medium text-text-secondary">
              Hay demasiados pendientes para confirmar si faltan comunas sin andén
            </span>
          </div>
        </div>
      ) : (
        unassignedComunasCount > 0 && (
          // Review round 2, finding #1 — `4l` nests two toned elements: the
          // footer container (`:1244`, border-top + surface) and an inner
          // warning pill (`:1245`, warn-bg/warn-border, rounded). Collapsing
          // them into one left the warning as plain amber text on surface.
          <div
            data-testid="unassigned-comunas-banner"
            className="flex flex-none flex-col gap-2 border-t border-border bg-surface px-5 py-3.5"
          >
            <div className="flex items-center gap-2.5 rounded-[11px] border border-status-warning-border bg-status-warning-bg px-3.5 py-2.5">
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
          </div>
        )
      )}
    </div>
  );
}
