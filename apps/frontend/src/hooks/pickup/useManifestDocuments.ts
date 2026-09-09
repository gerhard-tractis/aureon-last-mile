import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ManifestDocument {
  id: string;
  storage_path: string;
  sheet_number: number;
  captured_at: string;
}

/**
 * spec-80 fase 3 (5f) — fotos del manifiesto firmado, listadas por hoja.
 */
export function useManifestDocuments(operatorId: string | null, manifestId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'manifest-documents', manifestId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifest_documents')
        .select('id, storage_path, sheet_number, captured_at')
        .eq('operator_id', operatorId!)
        .eq('manifest_id', manifestId!)
        .is('deleted_at', null)
        .order('sheet_number', { ascending: true });
      if (error) throw error;
      return data as ManifestDocument[];
    },
    enabled: !!operatorId && !!manifestId,
    staleTime: 10_000,
  });
}

interface UploadManifestDocumentInput {
  operatorId: string;
  manifestId: string;
  userId: string;
  sheetNumber: number;
  file: File;
}

/**
 * Sube la foto al bucket privado `manifests` (prefijada
 * operator_id/manifest_id/, misma convención que useCameraIntake.ts) y sólo
 * si la subida tiene éxito inserta la fila en manifest_documents.
 *
 * Bloqueante 2, ronda 2 de review del PR #706 — un doble toque en "Agregar"
 * (el caller calcula `sheetNumber` antes de que el refetch de la lista
 * resuelva) puede hacer que el `upload` tenga éxito pero el `insert`
 * reviente con 23505 (`UNIQUE(manifest_id, sheet_number)`). Sin limpiar el
 * objeto ya subido, eso deja un huérfano permanente en el bucket — nada lo
 * referencia ni lo borrará nunca. Si el `insert` falla, se intenta borrar lo
 * subido antes de relanzar; si el borrado también falla, se loguea pero NO
 * se traga el error original del insert (el caller necesita saber que el
 * insert falló, sea cual sea el estado del bucket).
 */
export function useUploadManifestDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadManifestDocumentInput) => {
      const supabase = createSPAClient();
      const storagePath = `${input.operatorId}/${input.manifestId}/sheet-${input.sheetNumber}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('manifests')
        .upload(storagePath, input.file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from('manifest_documents').insert({
        operator_id: input.operatorId,
        manifest_id: input.manifestId,
        storage_path: storagePath,
        sheet_number: input.sheetNumber,
        uploaded_by: input.userId,
      });
      if (insertError) {
        const { error: removeError } = await supabase.storage.from('manifests').remove([storagePath]);
        if (removeError) {
          console.error('Failed to remove orphaned manifest document from storage:', removeError);
        }
        throw insertError;
      }
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['pickup', 'manifest-documents', input.manifestId],
      });
    },
  });
}
