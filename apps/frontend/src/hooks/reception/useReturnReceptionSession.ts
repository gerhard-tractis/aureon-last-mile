import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { resolveRoutesByOrder } from './returnRouteResolution';
import {
  findOrCreateSession,
  loadPackagesForRoute,
  findPackageByBarcode,
  recordUnmatchedScan,
} from './useReturnReceptionSession.queries';

export interface ReturnReceptionPackage {
  id: string;
  label: string;
  order_number: string | null;
  return_reason: string | null;
  /** orders.comuna — real column, joined alongside order_number. */
  comuna: string | null;
  received: boolean;
}

export type ScanOutcome =
  | { result: 'received'; packageId: string; orderStatus: string; remaining: number }
  | { result: 'not_found'; barcode: string }
  | { result: 'route_mismatch'; barcode: string }
  | { result: 'duplicate'; barcode: string };

export interface ReturnReceptionSessionResult {
  sessionId: string | null;
  /** hub_reception_status_enum — 'pending' | 'in_progress' | 'completed'. */
  status: string | null;
  expectedCount: number;
  receivedCount: number;
  packages: ReturnReceptionPackage[];
  /**
   * routes.driver_name for the route the returning packages came from —
   * already resolved per-order by resolveRoutesByOrder for the route-mismatch
   * check; this just surfaces it instead of discarding it. Null when no
   * dispatch/route row is found (mirrors useReturnRoutes' 'Sin ruta' fallback,
   * left to the caller to render).
   */
  driverName: string | null;
  isLoading: boolean;
  scan: (barcode: string) => Promise<ScanOutcome>;
  error: Error | null;
  /** Error from the packages query specifically — kept separate from
   *  `error` (session query) so the UI can tell "session not found" apart
   *  from "packages failed to load" instead of silently rendering an empty
   *  list for both. */
  packagesError: Error | null;
}

interface UseReturnReceptionSessionOptions {
  operatorId: string | null;
  externalRouteId: string | null;
}

export function useReturnReceptionSession({
  operatorId,
  externalRouteId,
}: UseReturnReceptionSessionOptions): ReturnReceptionSessionResult {
  const queryClient = useQueryClient();
  const enabled = !!operatorId && !!externalRouteId;

  const { data: session, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['return-reception-session', operatorId, externalRouteId],
    queryFn: () => findOrCreateSession(operatorId!, externalRouteId!),
    enabled,
    staleTime: 10_000,
  });

  const { data: packages, isLoading: pkgsLoading, error: pkgsError } = useQuery({
    queryKey: ['return-reception-packages', operatorId, externalRouteId, session?.id],
    queryFn: () => loadPackagesForRoute(operatorId!, externalRouteId!, session!.id),
    enabled: enabled && !!session?.id,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!enabled) return;
    const supabase = createSPAClient();
    const channel = supabase
      .channel(`return-session:${operatorId}:${externalRouteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'packages',
          filter: `operator_id=eq.${operatorId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['return-reception-packages', operatorId, externalRouteId],
          });
          queryClient.invalidateQueries({
            queryKey: ['return-reception-session', operatorId, externalRouteId],
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, operatorId, externalRouteId, queryClient]);

  const scan = async (barcode: string): Promise<ScanOutcome> => {
    if (!operatorId || !externalRouteId || !session) {
      return { result: 'not_found', barcode };
    }

    const supabase = createSPAClient();
    const sessionId = session.id;

    const pkg = await findPackageByBarcode(operatorId, barcode);
    if (!pkg) {
      await recordUnmatchedScan(operatorId, sessionId, barcode, 'not_found', null);
      return { result: 'not_found', barcode };
    }

    const routes = await resolveRoutesByOrder(supabase, operatorId, [pkg.order_id]);
    const pkgExternalRouteId = routes.get(pkg.order_id)?.externalRouteId ?? null;

    if (pkgExternalRouteId !== externalRouteId) {
      await recordUnmatchedScan(operatorId, sessionId, barcode, 'route_mismatch', pkg.id);
      return { result: 'route_mismatch', barcode };
    }

    const { data: existingScans } = await supabase
      .from('return_reception_scans')
      .select('id, scan_result')
      .eq('return_reception_id', sessionId)
      .eq('package_id', pkg.id)
      .eq('scan_result', 'received');
    if (existingScans && existingScans.length > 0) {
      return { result: 'duplicate', barcode };
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id ?? null;

    const { data: rpcResult, error: rpcErr } = await supabase.rpc(
      'complete_return_reception_scan',
      {
        p_package_id: pkg.id,
        p_return_reception_id: sessionId,
        p_scanned_by: userId,
        p_barcode: barcode,
        p_operator_id: operatorId,
      }
    );

    if (rpcErr) {
      // The RPC re-validates the package is still in retorno_hub under a row
      // lock. A fast double-scan from a Bluetooth scanner can pass the client
      // duplicate check (state hasn't propagated yet) and only collide here.
      // Surface that race as duplicate instead of a hard throw.
      const message = (rpcErr as { message?: string }).message ?? '';
      if (/package_not_found_or_wrong_status/i.test(message)) {
        return { result: 'duplicate', barcode };
      }
      throw rpcErr;
    }
    const rpc = rpcResult as { order_status?: string; remaining?: number } | null;
    if (rpc && 'error' in rpc && (rpc as { error?: string }).error === 'package_not_found_or_wrong_status') {
      return { result: 'duplicate', barcode };
    }

    queryClient.invalidateQueries({
      queryKey: ['return-reception-packages', operatorId, externalRouteId, sessionId],
    });
    queryClient.invalidateQueries({
      queryKey: ['return-reception-session', operatorId, externalRouteId],
    });

    return {
      result: 'received',
      packageId: pkg.id,
      orderStatus: rpc?.order_status ?? 'unknown',
      remaining: rpc?.remaining ?? 0,
    };
  };

  return {
    sessionId: session?.id ?? null,
    status: session?.status ?? null,
    expectedCount: session?.expected_count ?? 0,
    receivedCount: session?.received_count ?? 0,
    packages: packages?.packages ?? [],
    driverName: packages?.driverName ?? null,
    isLoading: sessionLoading || pkgsLoading,
    scan,
    error: (sessionError as Error | null) ?? null,
    packagesError: (pkgsError as Error | null) ?? null,
  };
}
