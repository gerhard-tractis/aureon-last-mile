import { createSPAClient } from '@/lib/supabase/client';

export type DockScanResult = 'accepted' | 'rejected';

export interface DockScanValidationResult {
  scanResult: DockScanResult;
  packageId: string | null;
  packageLabel: string | null;
  message?: string;
}

export interface DockScanInput {
  barcode: string;
  batchId: string;
  targetZoneId: string;
  operatorId: string;
  mode: 'batch' | 'quicksort';
}

/** Statuses that are valid for sectorization scanning */
const SCANNABLE_STATUSES = ['en_bodega', 'sectorizado'];

export async function validateDockScan(
  input: DockScanInput
): Promise<DockScanValidationResult> {
  const { barcode, batchId, operatorId } = input;
  const supabase = createSPAClient();

  // 1. Duplicate check — already scanned in this batch?
  const { data: existing } = await supabase
    .from('dock_scans')
    .select('id')
    .eq('batch_id', batchId)
    .eq('barcode', barcode)
    .eq('scan_result', 'accepted')
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return { scanResult: 'rejected', packageId: null, packageLabel: barcode, message: 'Paquete ya escaneado en este lote' };
  }

  // 2. Look up package by label
  const { data: packageMatch } = await supabase
    .from('packages')
    .select('id, label, status, order_id, dock_zone_id')
    .eq('operator_id', operatorId)
    .eq('label', barcode)
    .is('deleted_at', null)
    .limit(1);

  if (!packageMatch || packageMatch.length === 0) {
    return { scanResult: 'rejected', packageId: null, packageLabel: null, message: 'Código no encontrado' };
  }

  const pkg = packageMatch[0];

  // 3. Validate status
  if (!SCANNABLE_STATUSES.includes(pkg.status)) {
    return {
      scanResult: 'rejected',
      packageId: null,
      packageLabel: pkg.label,
      message: `Paquete no está en bodega — estado actual: ${pkg.status}`,
    };
  }

  // 4. Valid — accept
  return {
    scanResult: 'accepted',
    packageId: pkg.id,
    packageLabel: pkg.label,
  };
}
