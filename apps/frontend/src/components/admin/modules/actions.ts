'use server';

import { revalidatePath } from 'next/cache';
import { createSSRClient } from '@/lib/supabase/server';
import { isValidModuleKey } from '@/lib/modules/registry';
import { callRpc } from '@/lib/supabase/rpc';

// spec-45 — these RPC names are not in the generated Functions union. callRpc
// handles that without detaching supabase.rpc from its client; see
// lib/supabase/rpc.ts for why the previous cast broke at runtime.

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

  const { error } = await callRpc(supabase, 'enable_module_for_operator', {
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

  const { error } = await callRpc(supabase, 'disable_module_for_operator', {
    p_operator_id: operatorId,
    p_module_key: moduleKey,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/modules');
}

export async function fetchOperatorsWithState(): Promise<OperatorWithModuleState[]> {
  const supabase = await assertSuperAdmin();
  const { data, error } = await callRpc<OperatorWithModuleState[]>(
    supabase,
    'list_operators_with_module_state',
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAudit(operatorId: string): Promise<ModuleAuditEntry[]> {
  const supabase = await assertSuperAdmin();
  const { data, error } = await callRpc<ModuleAuditEntry[]>(
    supabase,
    'get_module_audit_for_operator',
    { p_operator_id: operatorId },
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}
