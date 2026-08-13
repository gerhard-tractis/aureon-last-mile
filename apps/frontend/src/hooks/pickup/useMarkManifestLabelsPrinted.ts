import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

interface MarkLabelsPrintedArgs {
  manifestId: string;
}

/**
 * Calls `mark_manifest_labels_printed(p_manifest_id)` (spec-53). Fired by
 * PrintPackageLabels once window.print() has been dispatched — browsers do
 * not report print confirmation, so this only records that a print job was
 * sent, not that it succeeded.
 */
export function useMarkManifestLabelsPrinted() {
  const qc = useQueryClient();
  return useMutation<void, Error, MarkLabelsPrintedArgs>({
    mutationFn: async ({ manifestId }) => {
      const supabase = createSPAClient();
      const { error } = await supabase.rpc('mark_manifest_labels_printed', {
        p_manifest_id: manifestId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { manifestId }) => {
      qc.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
      qc.invalidateQueries({ queryKey: ['pickup', 'manifest-labels', manifestId] });
    },
  });
}
