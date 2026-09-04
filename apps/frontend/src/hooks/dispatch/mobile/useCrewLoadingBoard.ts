// apps/frontend/src/hooks/dispatch/mobile/useCrewLoadingBoard.ts
//
// spec-76 phase 1-2 — fetching for the crew mobile home (2a) and route list
// (2b). Scoped to TODAY's open routes only (route_date = todayISOInTimezone),
// unlike useLoadingMonitor.ts's 3-day manager view — this screen answers
// "what can I load right now", not "what has been open recently".
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { OPEN_ROUTE_STATUSES, type RouteStatus } from '@/lib/dispatch/types';
import { todayISOInTimezone, TIMEZONE } from '@/lib/utils/dateFormat';
import {
  buildRouteCards,
  countAndenPendingByRoute,
  routeCode,
  type CrewDispatchLinkRow,
  type CrewPackageRow,
  type RouteCard,
} from '@/lib/dispatch/mobile/crew-board';
import { computeTodayScanStats, type ShiftScanStats } from '@/lib/dispatch/mobile/crew-shift-stats';
import { civilDateOf } from '@/lib/dispatch/mobile/civil-date';
import { buildLoadableQueue } from '@/lib/dispatch/mobile/crew-queue';

const ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchChunked<Row>(
  ids: string[],
  run: (chunkIds: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const results = await Promise.all(
    chunk(ids, ID_CHUNK_SIZE)
      .filter((c) => c.length > 0)
      .map(async (c) => {
        const { data, error } = await run(c);
        if (error) throw error;
        return data ?? [];
      }),
  );
  return results.flat();
}

export interface LastDispatched {
  code: string;
  timeLabel: string;
}

export interface CrewLoadingBoard {
  routes: RouteCard[];
  myTask: RouteCard | null;
  queue: RouteCard[];
  shift: ShiftScanStats;
  lastDispatched: LastDispatched | null;
  packagesOnDock: number;
}

const EMPTY: CrewLoadingBoard = {
  routes: [],
  myTask: null,
  queue: [],
  shift: { scannedToday: 0, ratePerHour: null },
  lastDispatched: null,
  packagesOnDock: 0,
};

interface RawRouteRow {
  id: string;
  status: RouteStatus;
  vehicle_id: string | null;
  driver_name: string | null;
  created_at: string;
  load_position_id: string | null;
  load_position_released_at: string | null;
  load_positions: { code: string; label: string | null } | { code: string; label: string | null }[] | null;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function useCrewLoadingBoard(operatorId: string | null, userId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'mobile', 'crew-board', operatorId, userId],
    queryFn: async (): Promise<CrewLoadingBoard> => {
      const supabase = createSPAClient();
      const todayISO = todayISOInTimezone();

      const { data: routeRows, error: routesError } = await supabase
        .from('routes')
        .select(
          'id, status, vehicle_id, driver_name, created_at, load_position_id, load_position_released_at, load_positions(code, label)',
        )
        .eq('operator_id', operatorId!)
        .in('status', [...OPEN_ROUTE_STATUSES])
        .eq('route_date', todayISO)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (routesError) throw routesError;

      const routes = (routeRows ?? []) as unknown as RawRouteRow[];
      if (routes.length === 0) return EMPTY;

      const routeIds = routes.map((r) => r.id);
      const dispatchRows = await fetchChunked<CrewDispatchLinkRow>(routeIds, (ids) =>
        supabase
          .from('dispatches')
          .select('route_id, order_id')
          .in('route_id', ids)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      );

      const orderIds = [...new Set(dispatchRows.map((d) => d.order_id).filter((id): id is string => !!id))];
      const [packageRows, orderRows] = await Promise.all([
        fetchChunked<CrewPackageRow>(orderIds, (ids) =>
          supabase
            .from('packages')
            .select('order_id, loaded_at, loaded_by, status')
            .in('order_id', ids)
            .eq('operator_id', operatorId!)
            .is('deleted_at', null),
        ),
        fetchChunked<{ id: string; comuna: string | null }>(orderIds, (ids) =>
          supabase.from('orders').select('id, comuna').in('id', ids).eq('operator_id', operatorId!).is('deleted_at', null),
        ),
      ]);

      const comunaByOrder = new Map(orderRows.map((o) => [o.id, o.comuna]));

      // Names, for whoever else's loading a route (spec-76 decision 9).
      const loaderUserIds = [
        ...new Set(packageRows.map((p) => p.loaded_by).filter((id): id is string => !!id)),
      ];
      const userRows = await fetchChunked<{ id: string; full_name: string }>(loaderUserIds, (ids) =>
        supabase.from('users').select('id, full_name').in('id', ids).eq('operator_id', operatorId!).is('deleted_at', null),
      );
      const namesByUserId = new Map(userRows.map((u) => [u.id, u.full_name]));

      const routeRowsForCards = routes.map((r) => {
        const occupied = !!r.load_position_id && !r.load_position_released_at;
        const position = occupied ? firstOf(r.load_positions) : null;
        return {
          id: r.id,
          status: r.status,
          loadPositionLabel: position?.label ?? position?.code ?? null,
          // routes.vehicle_id/driver_name are only ever written by the
          // dispatch handler (POST .../dispatch), which runs after a route
          // leaves `loaded` — every route this board shows (draft, planned,
          // loading, loaded) predates that write, so both are always NULL
          // here today. Read from `r` rather than hardcoded null so the
          // card stops lying the day that changes, but no vehicle join is
          // added purely to resolve a code that cannot exist yet.
          vehicleExternalId: null,
          driverName: r.driver_name,
          createdAtIso: r.created_at,
        };
      });

      const cards = buildRouteCards(routeRowsForCards, dispatchRows, packageRows, comunaByOrder, namesByUserId, userId);

      const myTask = cards.find((c) => c.chip === 'tu_carga') ?? null;
      // spec-76 review I5 — a route blocked by another crew must not be
      // offered on "después de esta" as the next thing to load; see
      // buildLoadableQueue's own doc comment.
      const queue = buildLoadableQueue(cards, myTask?.id ?? null);

      const shift = computeTodayScanStats(packageRows, userId, todayISO, civilDateOf);

      // spec-76 review I4 — "N paquetes en andén" must count only boxes
      // physically on the dock (ON_ANDEN_STATUSES), not `packagesTotal`
      // (which correctly includes `en_bodega` — boxes on the route that
      // have not reached the andén yet).
      const andenPendingByRoute = countAndenPendingByRoute(dispatchRows, packageRows);
      const packagesOnDock = [...andenPendingByRoute.values()].reduce((sum, n) => sum + n, 0);

      // Last dispatched route today — audit_logs, not routes.updated_at
      // (spec-76: that column moves for unrelated reasons, e.g. the
      // load-position sweep after any other route's dispatch). Fetched as
      // "the most recent few" rather than with a server-side date filter:
      // Chile's UTC offset shifts with DST, so a hand-built "start of day"
      // instant would drift twice a year. The civil-date comparison below
      // (same `civilDateOf` used for the shift stats) is what actually
      // decides "today", not the query bound.
      const { data: recentDispatchLogs } = await supabase
        .from('audit_logs')
        .select('resource_id, timestamp')
        .eq('operator_id', operatorId!)
        .eq('action', 'dispatch_route')
        .order('timestamp', { ascending: false })
        .limit(5);

      const lastDispatchLog = (recentDispatchLogs ?? []).find(
        (log) => civilDateOf(log.timestamp as string) === todayISO,
      );

      const lastDispatched: LastDispatched | null = lastDispatchLog
        ? {
            code: routeCode(lastDispatchLog.resource_id as string),
            timeLabel: new Date(lastDispatchLog.timestamp as string).toLocaleTimeString('es-CL', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: TIMEZONE,
            }),
          }
        : null;

      return { routes: cards, myTask, queue, shift, lastDispatched, packagesOnDock };
    },
    enabled: !!operatorId,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}
