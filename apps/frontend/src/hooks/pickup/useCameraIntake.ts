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
  submit: (file: File, generatorId: string) => Promise<void>;
  reset: () => void;
}

export function useCameraIntake(): UseCameraIntakeReturn {
  const { operatorId } = useOperatorId();
  const [status, setStatus] = useState<IntakeStatus>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createSPAClient>['channel']> | null>(null);

  const reset = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe?.();
      channelRef.current = null;
    }
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  const submit = useCallback(
    async (file: File, generatorId: string) => {
      if (!operatorId) return;

      setStatus('uploading');
      setError(null);

      const supabase = createSPAClient();
      const path = `${operatorId}/${generatorId}/${Date.now()}-${file.name}`;

      // 1. Upload image to Storage
      const { error: uploadError } = await supabase.storage.from('manifests').upload(path, file);
      if (uploadError) {
        setStatus('error');
        setError(uploadError.message);
        return;
      }

      // 2. Insert intake_submissions row
      const { error: insertError } = await supabase.from('intake_submissions').insert({
        operator_id: operatorId,
        generator_id: generatorId,
        channel: 'mobile_camera',
        status: 'received',
        raw_payload: { storage_path: path, file_name: file.name },
      });
      if (insertError) {
        setStatus('error');
        setError(insertError.message);
        return;
      }

      setStatus('processing');

      // 3. Subscribe to Realtime for status updates on this submission
      const channel = supabase
        .channel(`intake:${operatorId}:${generatorId}:${Date.now()}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'intake_submissions',
            filter: `operator_id=eq.${operatorId}`,
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
          }
        )
        .subscribe();

      channelRef.current = channel;
    },
    [operatorId]
  );

  return { status, result, error, submit, reset };
}
