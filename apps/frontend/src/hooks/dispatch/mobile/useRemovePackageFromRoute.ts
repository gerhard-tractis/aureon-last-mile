'use client';

// apps/frontend/src/hooks/dispatch/mobile/useRemovePackageFromRoute.ts
//
// spec-76 task 4 (2h) — the client side of `DELETE
// /api/dispatch/routes/[id]/packages/[pkgId]`. Read the endpoint before
// writing this (route.ts + route.test.ts, spec-70 decisions 2/3), because
// what it actually does differs from what spec-76 decision 7 assumed, on
// three points — reported in this task's write-up, not silently patched
// over:
//
// 1. GRANULARITY. `[pkgId]` is a `dispatches.id`, not a `packages.id` —
//    despite the route segment's name. This removes the whole STOP (every
//    package on that order), not the single row the crew tapped "Quitar"
//    on. There is no per-package removal endpoint in this codebase.
// 2. RESULTING STATUS. The endpoint resets sibling packages to
//    `sectorizado`, not `asignado` — verified against
//    "resets the package to sectorizado, not asignado" in the endpoint's
//    own test file, and the repo-wide comment ("breakage #9. Nothing
//    writes 'asignado' any more") in both this route and DELETE
//    /routes/[id]. `sectorizado` is still in `DISPATCHABLE_STATUSES`, so
//    the package can still be re-scanned — the ONLY part of decision 7
//    that survives contact with the code.
// 3. AUTHORIZATION. The endpoint is gated to `canRemoveFromPlan` — a
//    manager role (ops_leader/operations_manager/admin/super_admin), by
//    spec-70's own deliberate design ("removal is a manager action, not
//    the scanner's... the person doing the loading cannot be the one who
//    shrinks the plan"). Nothing in this module authenticates the crew
//    as one of those roles. This hook does not attempt to hide the
//    control from a crew member client-side (this module has no existing
//    role-gating precedent to reuse, and guessing one would be exactly the
//    kind of fabrication the repo's rules forbid) — it surfaces whatever
//    the server actually returns, including a 403 with its real message,
//    rather than promising a removal client-side that the server refuses.
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface RemovePackageResult {
  ok: true;
  load_position_conflict: boolean;
}

export interface RemovePackageFailure {
  code?: string;
  message: string;
}

interface RemoveArgs {
  routeId: string;
  dispatchId: string;
  reason: string;
}

export function useRemovePackageFromRoute(operatorId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ routeId, dispatchId, reason }: RemoveArgs): Promise<RemovePackageResult> => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/packages/${dispatchId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure: RemovePackageFailure = {
          code: json.code,
          message: json.message ?? 'No se pudo quitar el paquete de la ruta',
        };
        throw failure;
      }
      return json as RemovePackageResult;
    },
    onSuccess: (_data, { routeId }) => {
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'mobile', 'route-packages-by-stop', routeId, operatorId] });
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'packages', routeId] });
    },
  });
}
