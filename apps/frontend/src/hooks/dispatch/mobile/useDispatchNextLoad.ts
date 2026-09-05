'use client';

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useCrewLoadingBoard } from '@/hooks/dispatch/mobile/useCrewLoadingBoard';
import { nextLoadLine, type NextLoad } from '@/lib/dispatch/mobile/dispatch-acta';

/**
 * spec-77 Fase 4, item 17 — the acta's "siguiente carga concreta". Reuses
 * `useCrewLoadingBoard`'s own queue (2a/2b, spec-76) instead of a second
 * query: the route this screen just dispatched is already `dispatched`,
 * outside `OPEN_ROUTE_STATUSES`, so it drops out of that board on its own
 * — the `excludeRouteId` filter below is defensive belt-and-braces for the
 * window before the board refetches.
 *
 * The signed-in user id is fetched here (mirrors `useCurrentUserName.ts`'s
 * own `auth.getUser()` pattern) rather than threaded down through
 * `DispatchRouteSurface` -> ... -> this screen — nothing in that chain
 * carries it today, and plumbing it through every intermediate component
 * for one acta line is not worth the surface area.
 */
export function useDispatchNextLoad(operatorId: string | null, excludeRouteId: string | null) {
  const { data: userId } = useQuery({
    queryKey: ['auth', 'current-user-id'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const { data: board } = useCrewLoadingBoard(operatorId, userId ?? null);

  const next = (board?.queue ?? []).find((c) => c.id !== excludeRouteId) ?? null;
  const value: NextLoad | null = next ? { id: next.id, code: next.code, comuna: next.comuna } : null;
  return value;
}

export { nextLoadLine };
