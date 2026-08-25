import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useGlobal } from '@/lib/context/GlobalContext';
import { UserRole } from '@/lib/types/auth.types';
import { toast } from 'sonner';

export interface ManualAssignmentInput {
  packageId: string;
  zoneId: string;
  barcode: string;
  isConsolidation: boolean;
}

// spec-68 Decisión 6 — ops_leader joins the manual-assign set alongside the
// two desk roles. It's the floor role that works all four stations
// (spec-66), and `4e`/`4f` put this emergency exit on its phone.
// warehouse_staff stays OUT deliberately: if anyone can hand-assign, the
// physical andén scan stops being a confirmation and becomes optional —
// exactly what validateDockDestination exists to prevent. This same set
// also gates the desktop ManualAssignMenu, so ops_leader gains that too;
// intended, not a side effect.
const MANAGER_ROLES: ReadonlySet<string> = new Set([
  UserRole.OPERATIONS_MANAGER,
  UserRole.ADMIN,
  UserRole.OPS_LEADER,
]);

export interface UseManualDockAssignmentOptions {
  /**
   * spec-68 Fase 3 review (finding #6) — suppresses this hook's own
   * `onError` toast. A batch caller invoking `mutateAsync` N times in
   * parallel (Promise.allSettled over a multi-bulto request) needs ONE
   * summary toast naming what succeeded/failed, not N identical "Error al
   * asignar manualmente" toasts. Default stays `false`: the other call
   * sites (batch/[batchId]/page.tsx, quicksort/page.tsx) each represent
   * one distinct real-time scan, where the per-call toast is correct.
   */
  silentErrors?: boolean;
}

/**
 * Manager/ops_leader fallback for dock assignment when the scanner is
 * broken. Writes a dock_scans row with manual_override = true so the audit
 * trail separates UI assignments from real scans.
 */
export function useManualDockAssignment(
  operatorId: string,
  userId: string,
  options?: UseManualDockAssignmentOptions,
) {
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
    onError: () => {
      if (!options?.silentErrors) {
        toast.error('Error al asignar manualmente. Intente de nuevo.');
      }
    },
  });

  return { ...mutation, canUse };
}
