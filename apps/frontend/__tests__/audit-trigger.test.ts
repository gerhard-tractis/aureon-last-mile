/**
 * Integration Tests for Audit Trigger Function
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Tests audit trigger behavior on the orders table (no auth FK constraint).
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Requires: audit_trigger_func() deployed and attached to orders table
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

// Use real fetch for database integration tests (setup.ts mocks it)
// @ts-ignore - Using Node.js built-in fetch
import { fetch as nodeFetch } from 'undici';
vi.stubGlobal('fetch', nodeFetch);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('Audit Trigger Function - Integration Tests', () => {
  let supabase: SupabaseClient<Database>;
  let testOperatorId: string;

  beforeAll(async () => {
    if (!supabaseServiceKey || !supabaseUrl) {
      console.warn('⚠️ Skipping database tests: env vars not set');
      return;
    }
    supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

    // Create test operator
    const { data: operator } = await supabase
      .from('operators')
      .insert({ name: 'Test Operator - Audit Tests', slug: 'test-audit-trigger-' + Date.now() })
      .select()
      .single();
    if (!operator) throw new Error('Failed to create test operator');
    testOperatorId = operator.id;
  });

  afterAll(async () => {
    if (!supabase) return;
    if (testOperatorId) await supabase.from('operators').delete().eq('id', testOperatorId);
  });

  it.skipIf(!supabaseServiceKey)('should capture INSERT operation with after state', async () => {
    const { data: order } = await supabase
      .from('orders')
      .insert({
        operator_id: testOperatorId,
        order_number: 'AUDIT-INSERT-' + Date.now(),
        customer_name: 'Insert Test',
        customer_phone: '+56987654321',
        delivery_address: 'Test Address',
        comuna: 'Santiago',
        delivery_date: '2026-02-20',
        raw_data: { test: 'audit_insert' },
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
      })
      .select()
      .single();

    await new Promise(r => setTimeout(r, 300));

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_id', order?.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    expect(auditLogs).toBeDefined();
    expect(auditLogs?.length).toBeGreaterThan(0);

    const log = auditLogs?.[0];
    expect(log?.resource_type).toBe('orders');
    expect(log?.changes_json).toHaveProperty('after');
    expect(log?.changes_json).not.toHaveProperty('before');

    await supabase.from('orders').delete().eq('id', order?.id);
  });

  it.skipIf(!supabaseServiceKey)('should capture UPDATE operation with before and after state', async () => {
    const { data: order } = await supabase
      .from('orders')
      .insert({
        operator_id: testOperatorId,
        order_number: 'AUDIT-UPDATE-' + Date.now(),
        customer_name: 'Update Test Original',
        customer_phone: '+56987654321',
        delivery_address: 'Test Address',
        comuna: 'Santiago',
        delivery_date: '2026-02-20',
        raw_data: { test: 'audit_update' },
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
      })
      .select()
      .single();

    await supabase
      .from('orders')
      .update({ customer_name: 'Update Test Modified' })
      .eq('id', order?.id);

    await new Promise(r => setTimeout(r, 300));

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_id', order?.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    expect(auditLogs).toBeDefined();
    expect(auditLogs?.length).toBeGreaterThan(0);

    const log = auditLogs?.[0];
    expect(log?.changes_json).toHaveProperty('before');
    expect(log?.changes_json).toHaveProperty('after');
    expect((log?.changes_json as any).before.customer_name).toBe('Update Test Original');
    expect((log?.changes_json as any).after.customer_name).toBe('Update Test Modified');

    await supabase.from('orders').delete().eq('id', order?.id);
  });

  it.skipIf(!supabaseServiceKey)('should capture soft DELETE operation with before state', async () => {
    const { data: order } = await supabase
      .from('orders')
      .insert({
        operator_id: testOperatorId,
        order_number: 'AUDIT-DELETE-' + Date.now(),
        customer_name: 'Delete Test',
        customer_phone: '+56987654321',
        delivery_address: 'Test Address',
        comuna: 'Santiago',
        delivery_date: '2026-02-20',
        raw_data: { test: 'audit_delete' },
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
      })
      .select()
      .single();

    await supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', order?.id);

    await new Promise(r => setTimeout(r, 300));

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_id', order?.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    expect(auditLogs).toBeDefined();
    expect(auditLogs?.length).toBeGreaterThan(0);

    const log = auditLogs?.[0];
    expect(log?.changes_json).toHaveProperty('before');
    expect((log?.changes_json as any).before.deleted_at).toBeNull();
    expect((log?.changes_json as any).after.deleted_at).not.toBeNull();

    await supabase.from('orders').delete().eq('id', order?.id);
  });

  it.skipIf(!supabaseServiceKey)('should validate audit logging infrastructure exists', async () => {
    const { data: validation } = await supabase.rpc('validate_audit_logging');
    expect(validation).toBeDefined();
  });

  it.skipIf(!supabaseServiceKey)('should handle IP address from session variable', async () => {
    await supabase.rpc('set_config', {
      setting_name: 'app.request_ip',
      setting_value: '192.168.1.100',
      is_local: true
    });

    const { data: order } = await supabase
      .from('orders')
      .insert({
        operator_id: testOperatorId,
        order_number: 'AUDIT-IP-' + Date.now(),
        customer_name: 'IP Test',
        customer_phone: '+56987654321',
        delivery_address: 'Test Address',
        comuna: 'Santiago',
        delivery_date: '2026-02-20',
        raw_data: { test: 'ip_test' },
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
      })
      .select()
      .single();

    await new Promise(r => setTimeout(r, 300));

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_id', order?.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    const log = auditLogs?.[0];
    expect(log?.ip_address).toBeTruthy();

    await supabase.from('orders').delete().eq('id', order?.id);
  });

  it.skipIf(!supabaseServiceKey)('should default to "unknown" IP when session variable not set', async () => {
    const { data: order } = await supabase
      .from('orders')
      .insert({
        operator_id: testOperatorId,
        order_number: 'AUDIT-NOIP-' + Date.now(),
        customer_name: 'No IP Test',
        customer_phone: '+56987654321',
        delivery_address: 'Test Address',
        comuna: 'Santiago',
        delivery_date: '2026-02-20',
        raw_data: { test: 'no_ip' },
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
      })
      .select()
      .single();

    await new Promise(r => setTimeout(r, 300));

    const { data: auditLogs } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('resource_id', order?.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    const log = auditLogs?.[0];
    expect(log?.ip_address).toBe('unknown');

    await supabase.from('orders').delete().eq('id', order?.id);
  });
});
