import { createSPAClient } from '@/lib/supabase/client';
import type { DockZone } from './sectorization-engine';
import { scanCodesMatch } from '@/lib/scan/normalize-scan-code';

export type DockScanResult = 'accepted' | 'rejected';

/**
 * Outcome of validating the *destination* scan in Distribución (spec-39).
 * Binary rule: only the suggested anden or consolidación are accepted.
 *
 * spec-71 phase 3 review (item 3) — this used to compare with a bespoke
 * `trim().toUpperCase()` rule while `lib/scan/normalize-scan-code.ts`
 * carried a different one (strips punctuation too, for the same QA
 * hardware — see that file's doc comment) for `load_positions`. Two
 * disagreeing rules for the same "does this scanned code match that stored
 * one" job, on the same exposed scanner, was the bug: this now shares
 * `scanCodesMatch`, the same guarded comparison the position-scan path
 * uses (empty-normalization never matches; see that function's doc).
 */
export type DestinationOutcome =
  | { kind: 'accepted_suggested' }
  | { kind: 'accepted_consolidation'; zoneId: string }
  | { kind: 'rejected_wrong_dock'; expectedCode: string }
  | { kind: 'ambiguous'; expectedCode: string };

export interface DestinationContext {
  suggestedZoneCode: string;
  zones: DockZone[];
}

export function validateDockDestination(
  scannedCode: string,
  ctx: DestinationContext
): DestinationOutcome {
  if (scanCodesMatch(scannedCode, ctx.suggestedZoneCode)) {
    return { kind: 'accepted_suggested' };
  }

  // Item 1's mis-staging hazard, applied here: `.find()` picks an arbitrary
  // first match if two active consolidación zones' codes collided under
  // normalization. `.filter()` + a length check refuses instead of
  // guessing — same contract as `resolvePositionByScannedCode`.
  const consolidationMatches = ctx.zones.filter(
    z => z.is_consolidation && z.is_active && scanCodesMatch(scannedCode, z.code)
  );
  if (consolidationMatches.length > 1) {
    return { kind: 'ambiguous', expectedCode: ctx.suggestedZoneCode };
  }
  if (consolidationMatches.length === 1) {
    return { kind: 'accepted_consolidation', zoneId: consolidationMatches[0].id };
  }

  return { kind: 'rejected_wrong_dock', expectedCode: ctx.suggestedZoneCode };
}

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
    .eq('operator_id', operatorId)
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
