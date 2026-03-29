import { useState, useRef, useCallback } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useOperatorId';

export type IntakeStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

export interface IntakeResult {
  ordersCreated: number;
}

interface UseCameraIntakeReturn {
  status: IntakeStatus;
  result: IntakeResult | null;
  error: string | null;
  uploadProgress: { current: number; total: number } | null;
  submit: (files: File[], pickupPointId: string) => Promise<void>;
  reset: () => void;
}

export function useCameraIntake(): UseCameraIntakeReturn {
  const { operatorId } = useOperatorId();
  const [status, setStatus] = useState<IntakeStatus>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createSPAClient>['channel']> | null>(null);

  const reset = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe?.();
      channelRef.current = null;
    }
    setStatus('idle');
    setResult(null);
    setError(null);
    setUploadProgress(null);
  }, []);

  const submit = useCallback(
    async (files: File[], pickupPointId: string) => {
      if (!operatorId || files.length === 0) return;

      setStatus('uploading');
      setError(null);

      const supabase = createSPAClient();
      const timestamp = Date.now();
      const storagePaths: string[] = [];

      // Upload files sequentially (mobile connections may be slow)
      for (let i = 0; i < files.length; i++) {
        setUploadProgress({ current: i + 1, total: files.length });
        const path = `${operatorId}/${pickupPointId}/${timestamp}/page-${i + 1}.jpg`;
        const { error: uploadError } = await supabase.storage.from('manifests').upload(path, files[i]);
        if (uploadError) {
          setStatus('error');
          setError(uploadError.message);
          return;
        }
        storagePaths.push(path);
      }

      // Insert intake_submissions row and capture the ID
      const { data: submission, error: insertError } = await (supabase.from as CallableFunction)(
        'intake_submissions',
      )
        .insert({
          operator_id: operatorId,
          pickup_point_id: pickupPointId,
          channel: 'mobile_camera',
          status: 'received',
          raw_payload: { storage_paths: storagePaths, file_count: files.length },
        })
        .select('id')
        .single();

      if (insertError || !submission) {
        setStatus('error');
        setError(insertError?.message ?? 'Failed to create submission');
        return;
      }

      setStatus('processing');
      setUploadProgress(null);

      // Subscribe to Realtime filtered by submission ID
      const channel = supabase
        .channel(`intake:${submission.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'intake_submissions',
            filter: `id=eq.${submission.id}`,
          },
          (payload: { new: { status: string; orders_created: number } }) => {
            const { status: newStatus, orders_created } = payload.new;
            if (newStatus === 'parsed' || newStatus === 'needs_review' || newStatus === 'confirmed') {
              setResult({ ordersCreated: orders_created ?? 0 });
              setStatus('success');
            } else if (newStatus === 'failed' || newStatus === 'rejected') {
              setStatus('error');
              setError('El manifiesto no pudo ser procesado');
            }
          },
        )
        .subscribe();

      channelRef.current = channel;
    },
    [operatorId],
  );

  return { status, result, error, uploadProgress, submit, reset };
}
