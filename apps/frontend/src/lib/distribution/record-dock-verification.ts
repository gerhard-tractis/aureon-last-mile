import { createSPAClient } from '@/lib/supabase/client';

export type DockVerificationSource = 'scan' | 'tap';

export interface RecordDockVerificationInput {
  operatorId: string;
  packageId: string;
  userId: string;
  source: DockVerificationSource;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Writes one dock_verifications row (spec-39).
 *
 * Idempotent by way of the partial unique index: verifying a package that is
 * already verified is a no-op, so a crew member can re-scan a CTN they are not
 * sure about without the write failing under them.
 *
 * Deliberately silent — no audio, no query invalidation. Both callers already
 * own those: the tap mutation plays its own confirmation, and the scan mutation
 * plays one beep for the scan as a whole rather than two.
 */
export async function recordDockVerification({
  operatorId,
  packageId,
  userId,
  source,
}: RecordDockVerificationInput): Promise<void> {
  const supabase = createSPAClient();
  const { error } = await supabase.from('dock_verifications').insert({
    operator_id: operatorId,
    package_id: packageId,
    verified_by: userId,
    source,
    verified_at: new Date().toISOString(),
  });
  if (error && error.code !== PG_UNIQUE_VIOLATION) {
    throw error;
  }
}
