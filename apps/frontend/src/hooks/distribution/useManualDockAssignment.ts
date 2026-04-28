import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useGlobal } from '@/lib/context/GlobalContext';
import { UserRole } from '@/lib/types/auth.types';

export interface ManualAssignmentInput {
  packageId: string;
  zoneId: string;
  barcode: string;
  isConsolidation: boolean;
}

const MANAGER_ROLES: ReadonlySet<string> = new Set([
  UserRole.OPERATIONS_MANAGER,
  UserRole.ADMIN,
]);

/**
 * Manager-only fallback for dock assignment when the scanner is broken.
 * Writes a dock_scans row with manual_override = true so the audit trail
 * separates UI assignments from real scans.
 */
export function useManualDockAssignment(operatorId: string, userId: string) {
  const { role } = useGlobal();
  const canUse = role !== null && MANAGER_ROLES.has(role);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: ManualAssignmentInput) => {
      const supabase = createSPAClient();
      const { error } = await supabase.from('dock_scans').insert({
        operator_id: operatorId,
        package_id: input.packageId,
        dock_zone_id: input.zoneId,
        barcode: input.barcode,
        scan_result: 'accepted',
        scanned_by: userId,
        scanned_at: new Date().toISOString(),
        manual_override: true,
        ...(input.isConsolidation
          ? { redirect_reason: 'manual_consolidation' as const }
          : {}),
      });
      if (error) throw error;
      return input;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'pending-sectorization', operatorId],
      });
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'consolidation', operatorId],
      });
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'sectorized-by-zone', operatorId],
      });
    },
  });

  return { ...mutation, canUse };
}
