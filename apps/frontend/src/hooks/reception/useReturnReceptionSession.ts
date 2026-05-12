import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { resolveRoutesByOrder } from './returnRouteResolution';

export interface ReturnReceptionPackage {
  id: string;
  label: string;
  order_number: string | null;
  return_reason: string | null;
  received: boolean;
}

export type ScanOutcome =
  | { result: 'received'; packageId: string; orderStatus: string; remaining: number }
  | { result: 'not_found'; barcode: string }
  | { result: 'route_mismatch'; barcode: string }
  | { result: 'duplicate'; barcode: string };

export interface ReturnReceptionSessionResult {
  sessionId: string | null;
  expectedCount: number;
  receivedCount: number;
  packages: ReturnReceptionPackage[];
  isLoading: boolean;
  scan: (barcode: string) => Promise<ScanOutcome>;
  error: Error | null;
}

interface UseReturnReceptionSessionOptions {
  operatorId: string | null;
  externalRouteId: string | null;
}

interface RawSession {
  id: string;
  operator_id: string;
  external_route_id: string;
  status: string;
  expected_count: number;
  received_count: number;
}

interface RawScan {
  id: string;
  package_id: string | null;
  scan_result: string;
  barcode: string;
}

async function findOrCreateSession(
  operatorId: string,
  externalRouteId: string
): Promise<RawSession> {
  const supabase = createSPAClient();
  const { data, error } = await supabase.rpc('find_or_create_return_reception', {
    p_operator_id: operatorId,
    p_external_route_id: externalRouteId,
  });
  if (error) throw error;
  return data as unknown as RawSession;
}

async function loadPackagesForRoute(
  operatorId: string,
  externalRouteId: string,
  sessionId: string
): Promise<ReturnReceptionPackage[]> {
  const supabase = createSPAClient();

  const { data: pkgs, error: pkgsErr } = await supabase
    .from('packages')
    .select('id, order_id, label, return_reason, status_updated_at, orders(order_number)')
    .eq('operator_id', operatorId)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);
  if (pkgsErr) throw pkgsErr;
  if (!pkgs || pkgs.length === 0) return [];

  type PkgRow = {
    id: string;
    order_id: string;
    label: string;
    return_reason: string | null;
    orders: { order_number: string } | null;
  };
  const packages = pkgs as PkgRow[];
  const orderIds = [...new Set(packages.map(p => p.order_id))];

  const routesByOrder = await resolveRoutesByOrder(supabase, operatorId, orderIds);

  const { data: scans } = await supabase
    .from('return_reception_scans')
    .select('id, package_id, scan_result, barcode')
    .eq('return_reception_id', sessionId)
    .eq('operator_id', operatorId);

  const receivedPackageIds = new Set(
    ((scans ?? []) as RawScan[])
      .filter(s => s.scan_result === 'received' && s.package_id)
      .map(s => s.package_id as string)
  );

  const result: ReturnReceptionPackage[] = [];
  for (const pkg of packages) {
    const pkgExternalRoute = routesByOrder.get(pkg.order_id)?.externalRouteId ?? null;
    if (pkgExternalRoute !== externalRouteId) continue;
    result.push({
      id: pkg.id,
      label: pkg.label,
      order_number: pkg.orders?.order_number ?? null,
      return_reason: pkg.return_reason ?? null,
      received: receivedPackageIds.has(pkg.id),
    });
  }
  return result;
}

async function findPackageByBarcode(
  operatorId: string,
  barcode: string
): Promise<{ id: string; order_id: string; label: string } | null> {
  const supabase = createSPAClient();
  const { data } = await supabase
    .from('packages')
    .select('id, order_id, label, status')
    .eq('operator_id', operatorId)
    .eq('label', barcode)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);
  const row = (data ?? [])[0] as
    | { id: string; order_id: string; label: string; status: string }
    | undefined;
  return row ? { id: row.id, order_id: row.order_id, label: row.label } : null;
}

async function recordUnmatchedScan(
  operatorId: string,
  sessionId: string,
  barcode: string,
  scanResult: 'not_found' | 'route_mismatch',
  packageId: string | null
): Promise<void> {
  const supabase = createSPAClient();
  await supabase.from('return_reception_scans').insert({
    return_reception_id: sessionId,
    operator_id: operatorId,
    barcode,
    scan_result: scanResult,
    package_id: packageId,
    scanned_at: new Date().toISOString(),
  });
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

  const { data: packages, isLoading: pkgsLoading } = useQuery({
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
    expectedCount: session?.expected_count ?? 0,
    receivedCount: session?.received_count ?? 0,
    packages: packages ?? [],
    isLoading: sessionLoading || pkgsLoading,
    scan,
    error: (sessionError as Error | null) ?? null,
  };
}
