import type { SupabaseClient } from '@supabase/supabase-js';
import { createSPAClient } from '@/lib/supabase/client';
import { resolveRoutesByOrder } from './returnRouteResolution';
import type { ReturnReceptionPackage } from './useReturnReceptionSession';

/**
 * spec-43 / spec-54 — Supabase reads for a return reception session, split
 * out of useReturnReceptionSession.ts to keep that file under the 300-line
 * limit (docs/architecture.md).
 */

export interface RawSession {
  id: string;
  operator_id: string;
  external_route_id: string;
  status: string;
  expected_count: number;
  received_count: number;
}

export interface RawScan {
  id: string;
  package_id: string | null;
  scan_result: string;
  barcode: string;
}

export interface LoadedPackagesForRoute {
  packages: ReturnReceptionPackage[];
  /**
   * driver_name of the route these returns came from — the first NON-NULL
   * driverName found while iterating packages, not literally "the first
   * package's route". Every package here shares the same externalRouteId,
   * but that id can come from `dispatches.external_route_id` directly (no
   * `route_id`, so no route row and no driver_name) OR be resolved via
   * `routes.external_route_id`. When packages mix both origins for the same
   * externalRouteId, this can surface a route/driver that isn't the one
   * every package actually shipped on. Acceptable for a single-line header
   * label; do not rely on it for anything that needs to be exact per-package.
   */
  driverName: string | null;
}

export async function findOrCreateSession(
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

export async function loadPackagesForRoute(
  operatorId: string,
  externalRouteId: string,
  sessionId: string
): Promise<LoadedPackagesForRoute> {
  const supabase = createSPAClient();

  const { data: pkgs, error: pkgsErr } = await supabase
    .from('packages')
    .select('id, order_id, label, return_reason, status_updated_at, orders(order_number, comuna)')
    .eq('operator_id', operatorId)
    .eq('status', 'retorno_hub')
    .is('deleted_at', null);
  if (pkgsErr) throw pkgsErr;
  if (!pkgs || pkgs.length === 0) return { packages: [], driverName: null };

  type PkgRow = {
    id: string;
    order_id: string;
    label: string;
    return_reason: string | null;
    orders: { order_number: string; comuna: string | null } | null;
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
  let driverName: string | null = null;
  for (const pkg of packages) {
    const route = routesByOrder.get(pkg.order_id);
    const pkgExternalRoute = route?.externalRouteId ?? null;
    if (pkgExternalRoute !== externalRouteId) continue;
    if (driverName === null) driverName = route?.driverName ?? null;
    result.push({
      id: pkg.id,
      label: pkg.label,
      order_number: pkg.orders?.order_number ?? null,
      comuna: pkg.orders?.comuna ?? null,
      return_reason: pkg.return_reason ?? null,
      received: receivedPackageIds.has(pkg.id),
    });
  }
  return { packages: result, driverName };
}

export async function findPackageByBarcode(
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

export async function recordUnmatchedScan(
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

export type { SupabaseClient };
