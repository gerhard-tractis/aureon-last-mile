'use server';

import { revalidatePath } from 'next/cache';
import { createSSRClient } from '@/lib/supabase/server';
import { isValidModuleKey } from '@/lib/modules/registry';

// spec-45 — these RPCs are new in this PR; until DB types are regenerated we
// cast through `unknown` to bypass the generated function-name union.
type RpcCall = <T>(
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;

export interface OperatorWithModuleState {
  operator_id: string;
  operator_name: string;
  operator_slug: string;
  enabled_modules: string[];
}

export interface ModuleAuditEntry {
  id: string;
  module_key: string;
  action: string;
  actor_user_id: string;
  at: string;
  reason: string | null;
}

async function assertSuperAdmin() {
  const supabase = await createSSRClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const role = session?.user?.app_metadata?.claims?.role;
  if (role !== 'super_admin') throw new Error('access denied');
  return supabase;
}

function assertReason(reason: string) {
  if (!reason || reason.trim().length === 0) {
    throw new Error('reason is required');
  }
}

export async function enableModule(
  operatorId: string,
  moduleKey: string,
  reason: string,
) {
  const supabase = await assertSuperAdmin();
  assertReason(reason);
  if (!isValidModuleKey(moduleKey)) throw new Error(`invalid module: ${moduleKey}`);

  const rpc = supabase.rpc as unknown as RpcCall;
  const { error } = await rpc('enable_module_for_operator', {
    p_operator_id: operatorId,
    p_module_key: moduleKey,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/modules');
}

export async function disableModule(
  operatorId: string,
  moduleKey: string,
  reason: string,
) {
  const supabase = await assertSuperAdmin();
  assertReason(reason);
  if (!isValidModuleKey(moduleKey)) throw new Error(`invalid module: ${moduleKey}`);

  const rpc = supabase.rpc as unknown as RpcCall;
  const { error } = await rpc('disable_module_for_operator', {
    p_operator_id: operatorId,
    p_module_key: moduleKey,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/modules');
}

export async function fetchOperatorsWithState(): Promise<OperatorWithModuleState[]> {
  const supabase = await assertSuperAdmin();
  const rpc = supabase.rpc as unknown as RpcCall;
  const { data, error } = await rpc<OperatorWithModuleState[]>(
    'list_operators_with_module_state',
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAudit(operatorId: string): Promise<ModuleAuditEntry[]> {
  const supabase = await assertSuperAdmin();
  const rpc = supabase.rpc as unknown as RpcCall;
  const { data, error } = await rpc<ModuleAuditEntry[]>(
    'get_module_audit_for_operator',
    { p_operator_id: operatorId },
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}
