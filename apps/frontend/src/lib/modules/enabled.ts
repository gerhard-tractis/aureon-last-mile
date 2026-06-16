import { cache } from 'react';
import * as Sentry from '@sentry/nextjs';
import { createSSRClient } from '@/lib/supabase/server';
import { ALL_MODULE_KEYS, ModuleKey, isValidModuleKey } from './registry';

export type EnabledModulesSet = ReadonlySet<ModuleKey>;

export const getEnabledModulesForCurrentUser = cache(
  async (): Promise<EnabledModulesSet> => {
    const supabase = await createSSRClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const operatorId = session?.user?.app_metadata?.claims?.operator_id;
    if (!operatorId) {
      return new Set();
    }

    const { data, error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string[] | null; error: { message: string } | null }>)(
      'get_enabled_modules_for_operator',
      { p_operator_id: operatorId },
    );
    if (error) {
      throw new Error(
        `get_enabled_modules_for_operator failed: ${error.message}`,
      );
    }

    const keys = (data ?? []) as string[];
    const filtered: ModuleKey[] = [];
    for (const k of keys) {
      if (isValidModuleKey(k)) {
        filtered.push(k);
      } else {
        Sentry.captureMessage(`Unknown module_key from DB: ${k}`, 'warning');
      }
    }
    return new Set(filtered);
  },
);

export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  const set = await getEnabledModulesForCurrentUser();
  return set.has(key);
}

export { ALL_MODULE_KEYS };
