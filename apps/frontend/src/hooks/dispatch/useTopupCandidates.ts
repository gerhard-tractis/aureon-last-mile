// apps/frontend/src/hooks/dispatch/useTopupCandidates.ts
//
// spec-73 phase 4b — the manager-facing top-up UI, reading
// `GET /api/dispatch/routes/[id]/topup` and writing
// `POST /api/dispatch/routes/[id]/topup/accept`
// (both built in phase 4 — see that migration and the two route handlers).
//
// Follows useDockZoneAdjacency.ts's shape: a `useQuery` for the read, a
// `useMutation` for the write, invalidating the read's query key on
// success. Unlike that hook, this one goes through the Next.js API routes
// rather than calling the RPCs directly from the client — phase 4 already
// built those routes as the auth/role/error-mapping boundary (same as
// every other write in this route family — packages/[pkgId] DELETE,
// blocks/[blockId] PATCH), so this hook reuses them rather than
// re-implementing that boundary with a direct `supabase.rpc(...)` call.
//
// `TopupAcceptError` carries the machine-readable `code` the API route
// already maps from the RPC's domain exceptions (see that route's own
// comment for the full list) so the component owns exactly one place that
// turns a code into Spanish copy — this hook never invents a message
// itself, only forwards the code.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dispatchRouteKey } from './useDispatchRoute';

export interface TopupCandidate {
  routeBlockId: string;
  donorRouteId: string;
  donorExternalRouteId: string | null;
  donorDriverName: string | null;
  comunaId: string;
  comunaName: string;
  packageCount: number;
}

export interface TopupCandidatesResult {
  routeId: string;
  eligible: boolean;
  reason: string | null;
  candidates: TopupCandidate[];
}

interface RawCandidate {
  route_block_id: string;
  donor_route_id: string;
  donor_external_route_id: string | null;
  donor_driver_name: string | null;
  comuna_id: string;
  comuna_name: string;
  package_count: number;
}

interface RawTopupResult {
  route_id: string;
  eligible: boolean;
  reason: string | null;
  candidates: RawCandidate[];
}

export function topupCandidatesQueryKey(routeId: string | null) {
  return ['dispatch', 'topup-candidates', routeId];
}

/**
 * The GET route's own error payload (`{ code, message? }`) — see
 * `app/api/dispatch/routes/[id]/topup/route.ts`.
 */
export class TopupCandidatesError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'TopupCandidatesError';
    this.code = code;
  }
}

/**
 * The accept route's own error payload — every refusal the RPC can raise,
 * mapped to a stable `code` string (see
 * `app/api/dispatch/routes/[id]/topup/accept/route.ts`):
 * ROUTE_NOT_FOUND, BLOCK_NOT_FOUND, DONOR_ROUTE_NOT_RAIDABLE,
 * RECEIVING_ROUTE_NOT_LOADABLE, ALREADY_HAS_TOPUP, AT_MAX_DROPS,
 * NOT_ADJACENT, OVER_TOPUP_CAP, BLOCK_ALREADY_STAGED, REASON_REQUIRED,
 * INVALID_TOPUP, FORBIDDEN, VALIDATION_ERROR, or QUERY_FAILED/
 * INTERNAL_ERROR for anything unexpected.
 */
export class TopupAcceptError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'TopupAcceptError';
    this.code = code;
  }
}

function toCamel(raw: RawTopupResult): TopupCandidatesResult {
  return {
    routeId: raw.route_id,
    eligible: raw.eligible,
    reason: raw.reason,
    candidates: (raw.candidates ?? []).map((c) => ({
      routeBlockId: c.route_block_id,
      donorRouteId: c.donor_route_id,
      donorExternalRouteId: c.donor_external_route_id,
      donorDriverName: c.donor_driver_name,
      comunaId: c.comuna_id,
      comunaName: c.comuna_name,
      packageCount: c.package_count,
    })),
  };
}

/**
 * `enabled` lets a caller withhold the fetch entirely (e.g. before the role
 * gate passes, or before the route id is known) rather than fire it and
 * discard a 403 — the component still gates on role itself (defence in
 * depth per the spec), but there is no reason to make the request at all
 * for a role that can never see the result.
 */
export function useTopupCandidates(
  routeId: string | null,
  operatorId: string | null,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: topupCandidatesQueryKey(routeId),
    queryFn: async (): Promise<TopupCandidatesResult> => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/topup`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new TopupCandidatesError(json.code ?? 'UNKNOWN', json.message);
      }
      return toCamel(json as RawTopupResult);
    },
    enabled: !!routeId && !!operatorId && enabled,
    staleTime: 10_000,
  });
}

export interface AcceptTopupVariables {
  donorRouteId: string;
  comunaId: string;
  reason: string;
}

/**
 * On success, invalidates the suggestions list itself (a route can hold at
 * most one borrowed block — Decision 5.4 — so the freshly-accepted
 * suggestion must never linger as if still available) and the route's own
 * blocks/packages, which the accept just changed.
 */
export function useAcceptTopup(routeId: string | null, operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: AcceptTopupVariables) => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/topup/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donor_route_id: vars.donorRouteId,
          comuna_id: vars.comunaId,
          reason: vars.reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new TopupAcceptError(json.code ?? 'UNKNOWN', json.message);
      }
      return json;
    },
    onSettled: (_data, _error, vars) => {
      // Refetched on BOTH success and failure (a stale suggestion refused
      // by the database under lock is exactly the case that needs the list
      // refreshed, not just a successful accept — see spec's stale-
      // suggestion requirement).
      //
      // Review fix: BOTH routes, not just the receiving one. `accept_topup_block`
      // soft-deletes every dispatch for the comuna off the DONOR route and
      // moves its packages back to `sectorizado`, so the donor's own
      // RouteBuilder — block sequence, package list, and its own top-up
      // suggestions — is stale the moment this returns. Invalidating only the
      // receiving side left the borrowed block rendered on both routes until
      // something unrelated evicted the donor's cache.
      const affected = [routeId, vars?.donorRouteId ?? null];
      for (const id of affected) {
        if (!id) continue;
        queryClient.invalidateQueries({ queryKey: topupCandidatesQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: ['dispatch', 'route-blocks', id] });
        queryClient.invalidateQueries({ queryKey: ['dispatch', 'packages', id] });
        if (operatorId) {
          queryClient.invalidateQueries({ queryKey: dispatchRouteKey(id, operatorId) });
        }
      }
    },
  });
}
