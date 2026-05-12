import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ReturnReceptionPackage {
  id: string;
  label: string;
  order_number: string;
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

interface RawSession { id: string; operator_id: string; external_route_id: string; status: string; expected_count: number; received_count: number; }

interface RawScan { id: string; package_id: string | null; scan_result: string; barcode: string; }

async function countReturnPackagesForRoute(
  operatorId: string,
  externalRouteId: string
): Promise<number> {
  const supabase = createSPAClient();

  const { data: pkgs } = await supabase
    .from('packages')
    .select('id, order_id')
    .eq('operator_id', operatorId)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);

  if (!pkgs || pkgs.length === 0) return 0;

  const orderIds = (pkgs as { id: string; order_id: string }[]).map(p => p.order_id);

  const { data: dispatches } = await supabase
    .from('dispatches')
    .select('order_id, route_id, created_at')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const allDispatches = (dispatches ?? []) as { order_id: string; route_id: string; created_at: string }[];
  const latestByOrder = new Map<string, string>();
  for (const d of allDispatches) {
    if (!latestByOrder.has(d.order_id)) latestByOrder.set(d.order_id, d.route_id);
  }

  const routeIds = [...new Set(allDispatches.map(d => d.route_id))];
  if (routeIds.length === 0) return 0;

  const { data: routes } = await supabase
    .from('routes')
    .select('id, external_route_id')
    .eq('operator_id', operatorId)
    .in('id', routeIds);

  const routeExtMap = new Map<string, string>();
  for (const r of (routes ?? []) as { id: string; external_route_id: string }[]) {
    routeExtMap.set(r.id, r.external_route_id);
  }

  let count = 0;
  for (const pkg of pkgs as { id: string; order_id: string }[]) {
    const routeId = latestByOrder.get(pkg.order_id);
    if (routeId && routeExtMap.get(routeId) === externalRouteId) count++;
  }
  return count;
}

async function findOrCreateSession(
  operatorId: string,
  externalRouteId: string
): Promise<RawSession> {
  const supabase = createSPAClient();

  const { data: existing } = await supabase
    .from('return_receptions')
    .select('id, operator_id, external_route_id, status, expected_count, received_count')
    .eq('operator_id', operatorId)
    .eq('external_route_id', externalRouteId)
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0] as RawSession;
  }

  const [now, expectedCount] = [
    new Date().toISOString(),
    await countReturnPackagesForRoute(operatorId, externalRouteId),
  ];
  const { data: created, error } = await supabase
    .from('return_receptions')
    .insert({
      operator_id: operatorId,
      external_route_id: externalRouteId,
      status: 'in_progress',
      started_at: now,
      expected_count: expectedCount,
      received_count: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return created as RawSession;
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

  const orderIds = (pkgs as { order_id: string }[]).map(p => p.order_id);

  const { data: dispatches } = await supabase
    .from('dispatches')
    .select('order_id, route_id, created_at')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const allDispatches = (dispatches ?? []) as {
    order_id: string; route_id: string; created_at: string;
  }[];
  const latestByOrder = new Map<string, string>();
  for (const d of allDispatches) {
    if (!latestByOrder.has(d.order_id)) latestByOrder.set(d.order_id, d.route_id);
  }

  const routeIds = [...new Set(allDispatches.map(d => d.route_id))];
  let externalRouteByRouteId = new Map<string, string>();
  if (routeIds.length > 0) {
    const { data: routes } = await supabase
      .from('routes')
      .select('id, external_route_id')
      .eq('operator_id', operatorId)
      .in('id', routeIds);
    for (const r of (routes ?? []) as { id: string; external_route_id: string }[]) {
      externalRouteByRouteId.set(r.id, r.external_route_id);
    }
  }

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
  for (const pkg of pkgs as {
    id: string; order_id: string; label: string;
    return_reason: string | null;
    orders: { order_number: string } | null;
  }[]) {
    const routeId = latestByOrder.get(pkg.order_id);
    const pkgExternalRoute = routeId ? externalRouteByRouteId.get(routeId) : undefined;
    if (pkgExternalRoute !== externalRouteId) continue;

    result.push({
      id: pkg.id,
      label: pkg.label,
      order_number: pkg.orders?.order_number ?? pkg.order_id,
      return_reason: pkg.return_reason ?? null,
      received: receivedPackageIds.has(pkg.id),
    });
  }

  return result;
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
    staleTime: 60_000,
  });

  const { data: packages, isLoading: pkgsLoading } = useQuery({
    queryKey: ['return-reception-packages', operatorId, externalRouteId, session?.id],
    queryFn: () => loadPackagesForRoute(operatorId!, externalRouteId!, session!.id),
    enabled: enabled && !!session?.id,
    staleTime: 10_000,
  });

  const scan = async (barcode: string): Promise<ScanOutcome> => {
    if (!operatorId || !externalRouteId || !session) {
      return { result: 'not_found', barcode };
    }

    const supabase = createSPAClient();
    const sessionId = session.id;

    const { data: pkgRows } = await supabase
      .from('packages')
      .select('id, order_id, label, status')
      .eq('operator_id', operatorId)
      .eq('label', barcode)
      .eq('status', 'retorno_hub')
      .is('deleted_at', null);

    const pkg = (pkgRows ?? [])[0] as
      | { id: string; order_id: string; label: string; status: string }
      | undefined;

    if (!pkg) {
      await supabase.from('return_reception_scans').insert({
        return_reception_id: sessionId,
        operator_id: operatorId,
        barcode,
        scan_result: 'not_found',
        package_id: null,
        scanned_at: new Date().toISOString(),
      });
      return { result: 'not_found', barcode };
    }

    const { data: dispatches } = await supabase
      .from('dispatches')
      .select('order_id, route_id, created_at')
      .eq('operator_id', operatorId)
      .eq('order_id', pkg.order_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    const latestDispatch = (dispatches ?? [])[0] as
      | { route_id: string } | undefined;

    let pkgExternalRouteId: string | null = null;
    if (latestDispatch) {
      const { data: routes } = await supabase
        .from('routes')
        .select('id, external_route_id')
        .eq('operator_id', operatorId)
        .in('id', [latestDispatch.route_id]);

      const route = (routes ?? [])[0] as { external_route_id: string } | undefined;
      pkgExternalRouteId = route?.external_route_id ?? null;
    }

    if (pkgExternalRouteId !== externalRouteId) {
      // route_mismatch is recorded as 'not_found' in the DB because
      // reception_scan_result_enum predates this flow and lacks a route_mismatch value.
      await supabase.from('return_reception_scans').insert({
        return_reception_id: sessionId,
        operator_id: operatorId,
        barcode,
        scan_result: 'not_found',
        package_id: pkg.id,
        scanned_at: new Date().toISOString(),
      });
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

    if (rpcErr) throw rpcErr;

    const rpc = rpcResult as { order_status?: string; remaining?: number } | null;

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
