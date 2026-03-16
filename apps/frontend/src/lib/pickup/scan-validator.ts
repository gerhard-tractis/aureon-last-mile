import { createSPAClient } from '@/lib/supabase/client';

export type ScanResult = 'verified' | 'not_found' | 'duplicate';

export interface ScanValidationResult {
  scanResult: ScanResult;
  packageId: string | null;       // Primary package (for single matches)
  packageIds: string[];           // All packages (for order-number matches)
  packageLabel: string | null;
}

export async function validateScan(
  barcode: string,
  manifestId: string,
  operatorId: string,
  externalLoadId: string
): Promise<ScanValidationResult> {
  const supabase = createSPAClient();

  // 1. Duplicate check — already verified this barcode for this manifest?
  const { data: existing } = await supabase
    .from('pickup_scans')
    .select('id')
    .eq('manifest_id', manifestId)
    .eq('barcode_scanned', barcode)
    .eq('scan_result', 'verified')
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return { scanResult: 'duplicate', packageId: null, packageIds: [], packageLabel: barcode };
  }

  // 2. Search packages.label matching barcode within this load
  const { data: packageMatch } = await supabase
    .from('packages')
    .select('id, label, order_id')
    .eq('operator_id', operatorId)
    .eq('label', barcode)
    .is('deleted_at', null)
    .limit(1);

  if (packageMatch && packageMatch.length > 0) {
    // Verify the package's order belongs to this load
    const { data: orderMatch } = await supabase
      .from('orders')
      .select('id')
      .eq('id', packageMatch[0].order_id)
      .eq('external_load_id', externalLoadId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .limit(1);

    if (orderMatch && orderMatch.length > 0) {
      // 2b. Check if this package_id already has a verified scan (prevents double-counting)
      const { data: pkgDuplicate } = await supabase
        .from('pickup_scans')
        .select('id')
        .eq('manifest_id', manifestId)
        .eq('package_id', packageMatch[0].id)
        .eq('scan_result', 'verified')
        .is('deleted_at', null)
        .limit(1);

      if (pkgDuplicate && pkgDuplicate.length > 0) {
        return { scanResult: 'duplicate', packageId: packageMatch[0].id, packageIds: [], packageLabel: packageMatch[0].label };
      }

      return {
        scanResult: 'verified',
        packageId: packageMatch[0].id,
        packageIds: [packageMatch[0].id],
        packageLabel: packageMatch[0].label,
      };
    }
  }

  // 3. Search orders.order_number — if match, verify all packages for that order
  const { data: orderByNumber } = await supabase
    .from('orders')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('order_number', barcode)
    .eq('external_load_id', externalLoadId)
    .is('deleted_at', null)
    .limit(1);

  if (orderByNumber && orderByNumber.length > 0) {
    // Get all packages of this order
    const { data: orderPackages } = await supabase
      .from('packages')
      .select('id, label')
      .eq('order_id', orderByNumber[0].id)
      .is('deleted_at', null);

    const pkgs = orderPackages ?? [];

    // Get all already-verified package_ids for this manifest in one query
    const packageIds = pkgs.map(p => p.id);
    const { data: verifiedScans } = await supabase
      .from('pickup_scans')
      .select('package_id')
      .eq('manifest_id', manifestId)
      .in('package_id', packageIds)
      .eq('scan_result', 'verified')
      .is('deleted_at', null)
      .limit(packageIds.length);

    const verifiedPkgIds = new Set((verifiedScans ?? []).map((s: { package_id: string | null }) => s.package_id).filter((id): id is string => id !== null));
    const unverifiedPkgs = pkgs.filter(p => !verifiedPkgIds.has(p.id));

    if (unverifiedPkgs.length === 0) {
      return { scanResult: 'duplicate', packageId: pkgs[0]?.id ?? null, packageIds: [], packageLabel: pkgs[0]?.label ?? barcode };
    }

    return {
      scanResult: 'verified',
      packageId: unverifiedPkgs[0]?.id ?? null,
      packageIds: unverifiedPkgs.map(p => p.id),
      packageLabel: unverifiedPkgs[0]?.label ?? barcode,
    };
  }

  // 4. No match
  return { scanResult: 'not_found', packageId: null, packageIds: [], packageLabel: null };
}
