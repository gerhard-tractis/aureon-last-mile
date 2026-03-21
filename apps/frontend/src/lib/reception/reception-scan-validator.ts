import { createSPAClient } from '@/lib/supabase/client';

export type ReceptionScanResult = 'received' | 'not_found' | 'duplicate';

export interface ReceptionScanValidationResult {
  scanResult: ReceptionScanResult;
  packageId: string | null;
  packageLabel: string | null;
  message?: string;
}

interface ValidateReceptionScanInput {
  barcode: string;
  receptionId: string;
  manifestId: string;
  operatorId: string;
}

/** Statuses that mean the package has already been received or gone further */
const ALREADY_RECEIVED_STATUSES = [
  'en_bodega', 'sectorizado', 'retenido', 'asignado', 'en_carga', 'listo',
  'en_ruta', 'entregado', 'cancelado', 'devuelto',
  'dañado', 'extraviado',
];

/** Statuses that are before verificado (not ready for reception) */
const PRE_VERIFICADO_STATUSES = ['ingresado'];

export async function validateReceptionScan(
  input: ValidateReceptionScanInput
): Promise<ReceptionScanValidationResult> {
  const { barcode, receptionId, manifestId: _manifestId, operatorId } = input;
  const supabase = createSPAClient();

  // 1. Duplicate check — already scanned this barcode for this reception?
  const { data: existing } = await supabase
    .from('reception_scans')
    .select('id')
    .eq('reception_id', receptionId)
    .eq('barcode', barcode)
    .eq('scan_result', 'received')
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return { scanResult: 'duplicate', packageId: null, packageLabel: barcode };
  }

  // 2. Find package by label within this manifest's orders
  const { data: packageMatch } = await supabase
    .from('packages')
    .select('id, label, status, order_id')
    .eq('operator_id', operatorId)
    .eq('label', barcode)
    .is('deleted_at', null)
    .limit(1);

  if (!packageMatch || packageMatch.length === 0) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: null,
      message: 'Paquete no pertenece a esta carga',
    };
  }

  const pkg = packageMatch[0];

  // 3. Check package status
  if (PRE_VERIFICADO_STATUSES.includes(pkg.status)) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: pkg.label,
      message: 'Paquete no verificado en retiro',
    };
  }

  if (ALREADY_RECEIVED_STATUSES.includes(pkg.status)) {
    return {
      scanResult: 'not_found',
      packageId: null,
      packageLabel: pkg.label,
      message: 'Paquete ya fue recibido en bodega',
    };
  }

  // 4. Package is verificado — valid for reception
  return {
    scanResult: 'received',
    packageId: pkg.id,
    packageLabel: pkg.label,
  };
}
