import { createSPAClient } from '@/lib/supabase/client';
import type { DockZone } from './sectorization-engine';

/**
 * spec-68 Fase 5.4 review (findings #1/#2) — `4i`'s "Marcar excepción y
 * seguir". Pulled out of `useQuickSortFlow` so the row shape and its one
 * real decision (does the scanned code resolve to a known zone) are
 * unit-testable without React, and so the hook stays under this repo's
 * 300-line file guideline.
 *
 * Records the rejected andén scan in `dock_scans` with the existing
 * `scan_result` enum value `wrong_zone` — no new enum value. It does not
 * touch `packages` (no status change, no `dock_zone_id` write there) and
 * does not create an incident; the package stays exactly where
 * `determineDockZone` already had it.
 *
 * `dock_zone_id` (spec-39, migration 20260504000002) is resolved from the
 * scanned code against `zones`, using the same normalization
 * `validateDockDestination` uses, so an auditor can tell WHICH andén was
 * wrongly scanned — not just that one was. When the code matches no known
 * zone at all, `dock_zone_id` stays null; per review, no new column or
 * enum value is added to keep the raw code recoverable in that case, so
 * `barcode` carries the scanned code itself instead of the package label
 * for that one row. The package itself is still unambiguous via
 * `package_id` either way.
 *
 * PostgREST returns `{ error }` on a rejected insert rather than
 * throwing — this throws on it explicitly, the same convention every
 * other `dock_scans` insert in this codebase follows
 * (`useDockScans.ts`), so a caller's try/catch actually sees a rejected
 * write instead of silently treating it as success.
 */
export interface RecordQuickSortExceptionInput {
  operatorId: string;
  batchId: string;
  packageId: string;
  packageLabel: string;
  /** The andén code that was actually scanned and rejected. */
  rejectedCode: string;
  zones: DockZone[];
  userId: string;
}

export async function recordQuickSortException(input: RecordQuickSortExceptionInput): Promise<void> {
  const { operatorId, batchId, packageId, packageLabel, rejectedCode, zones, userId } = input;
  const matchedZone = zones.find(
    (z) => z.code.trim().toUpperCase() === rejectedCode.trim().toUpperCase(),
  );

  const supabase = createSPAClient();
  const { error } = await supabase.from('dock_scans').insert({
    operator_id: operatorId,
    batch_id: batchId,
    package_id: packageId,
    barcode: matchedZone ? packageLabel : rejectedCode,
    dock_zone_id: matchedZone?.id ?? null,
    scan_result: 'wrong_zone',
    scanned_by: userId,
    scanned_at: new Date().toISOString(),
  });
  if (error) throw error;
}
