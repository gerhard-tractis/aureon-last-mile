import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { ModuleKey, isValidModuleKey } from '@/lib/modules/registry';

/**
 * Client-side mirror of lib/modules/enabled.ts's
 * getEnabledModulesForCurrentUser, for client components (e.g. the pickup
 * screen) that need a module flag without a server round-trip through props.
 * Same RPC — get_enabled_modules_for_operator already validates p_operator_id
 * against the caller's own operator_id (spec-45), so this is safe to call
 * client-side.
 */
export function useEnabledModules(operatorId: string | null) {
  return useQuery({
    queryKey: ['modules', 'enabled', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      // Cast needed: get_enabled_modules_for_operator predates the generated
      // Functions type (same gap as get_pending_manifests et al. — see
      // hooks/pickup/useManifests.ts).
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string[] | null; error: { message: string } | null }>)(
        'get_enabled_modules_for_operator',
        { p_operator_id: operatorId! },
      );
      if (error) throw error;
      return ((data ?? []) as string[]).filter(isValidModuleKey) as ModuleKey[];
    },
    enabled: !!operatorId,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

export function useModuleEnabled(operatorId: string | null, key: ModuleKey): boolean {
  const { data } = useEnabledModules(operatorId);
  return data?.includes(key) ?? false;
}
