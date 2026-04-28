import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { playFeedback } from '@/lib/pickup/audio';

export type DockVerificationSource = 'scan' | 'tap';

export interface DockVerificationInput {
  packageId: string;
  source: DockVerificationSource;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Returns a Set<package_id> of packages verified today (eyes-on) by this operator.
 * Subscribes to the dock_verifications realtime channel and invalidates on change.
 */
export function useDockVerifications(
  operatorId: string | null,
  dateISO: string
) {
  const queryClient = useQueryClient();
  const queryKey = ['distribution', 'dock-verifications', operatorId, dateISO];

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    const channel = supabase
      .channel(`dock-verifications:${operatorId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'dock_verifications',
          filter: `operator_id=eq.${operatorId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, dateISO]);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<Set<string>> => {
      const supabase = createSPAClient();
      const dayStart = `${dateISO}T00:00:00.000Z`;
      const dayEnd = `${dateISO}T23:59:59.999Z`;
      const { data, error } = await supabase
        .from('dock_verifications')
        .select('package_id')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .gte('verified_at', dayStart)
        .lt('verified_at', dayEnd)
        .order('verified_at', { ascending: false });
      if (error) throw error;
      const ids = (data ?? []).map(r => (r as { package_id: string }).package_id);
      return new Set(ids);
    },
    enabled: !!operatorId,
    staleTime: 15_000,
  });
}

/**
 * Inserts a dock_verifications row. Idempotent: a unique-violation (a second
 * verify of the same package while the first is still active) is treated as a
 * no-op so taps and scans can be repeated safely.
 */
export function useDockVerificationMutation(operatorId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ packageId, source }: DockVerificationInput) => {
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
      playFeedback('verified');
      return { packageId, source };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'dock-verifications', operatorId],
      });
    },
  });
}
