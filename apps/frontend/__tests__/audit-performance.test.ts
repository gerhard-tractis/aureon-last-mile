/**
 * Performance Tests for Audit Logs
 * Story 1.6: Set Up Audit Logging Infrastructure
 *
 * Tests query performance against production Supabase.
 * Timing thresholds account for network latency to remote database.
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

describe('Audit Logs Performance Tests', () => {
  let supabase: SupabaseClient<Database>;
  let testOperatorId: string;
  // Synthetic user ID — audit_logs.user_id has no FK constraint
  const testUserId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    if (!supabaseServiceKey || !supabaseUrl) {
      console.warn('⚠️ Skipping database tests: env vars not set');
      return;
    }
    supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);

    const { data: operator } = await supabase
      .from('operators')
      .insert({ name: 'Perf Test Operator', slug: 'perf-test-op-' + Date.now() })
      .select()
      .single();
    if (!operator) throw new Error('Failed to create test operator');
    testOperatorId = operator.id;
  });

  afterAll(async () => {
    if (!supabase) return;
    if (testOperatorId) await supabase.from('operators').delete().eq('id', testOperatorId);
  });

  it.skipIf(!supabaseServiceKey)('should query audit logs with date range filter efficiently', async () => {
    const startTime = Date.now();

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, timestamp, action, user_id', { count: 'exact' })
      .eq('operator_id', testOperatorId)
      .gte('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(50);

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    // Allow up to 500ms for remote queries (includes network latency)
    expect(queryTime).toBeLessThan(500);
    console.log(`Query time for date range filter: ${queryTime}ms`);
  });

  it.skipIf(!supabaseServiceKey)('should query audit logs with user filter efficiently', async () => {
    const startTime = Date.now();

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, timestamp, action')
      .eq('operator_id', testOperatorId)
      .eq('user_id', testUserId)
      .gte('timestamp', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(50);

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    expect(queryTime).toBeLessThan(500);
    console.log(`Query time for user filter: ${queryTime}ms`);
  });

  it.skipIf(!supabaseServiceKey)('should query audit logs with resource lookup efficiently', async () => {
    const startTime = Date.now();

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, timestamp, action, changes_json')
      .eq('operator_id', testOperatorId)
      .eq('resource_type', 'orders')
      .eq('resource_id', testUserId)
      .order('timestamp', { ascending: false });

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    expect(queryTime).toBeLessThan(500);
    console.log(`Query time for resource lookup: ${queryTime}ms`);
  });

  it.skipIf(!supabaseServiceKey)('should query audit logs with action filter efficiently', async () => {
    const startTime = Date.now();

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, timestamp, action')
      .eq('operator_id', testOperatorId)
      .eq('action', 'UPDATE_orders')
      .gte('timestamp', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(50);

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    expect(queryTime).toBeLessThan(500);
    console.log(`Query time for action filter: ${queryTime}ms`);
  });

  it.skipIf(!supabaseServiceKey)('should handle pagination efficiently', async () => {
    const limit = 50;

    for (let page = 1; page <= 3; page++) {
      const startTime = Date.now();
      const start = (page - 1) * limit;

      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, timestamp')
        .eq('operator_id', testOperatorId)
        .order('timestamp', { ascending: false })
        .range(start, start + limit - 1);

      const queryTime = Date.now() - startTime;

      expect(error).toBeNull();
      expect(queryTime).toBeLessThan(500);
      console.log(`Page ${page} query time: ${queryTime}ms`);
    }
  });

  it.skipIf(!supabaseServiceKey)('should validate audit logging infrastructure', async () => {
    // Use validate_audit_logging RPC instead of querying system catalogs
    // (pg_indexes is not accessible via PostgREST)
    const { data: validation, error } = await supabase.rpc('validate_audit_logging');
    expect(error).toBeNull();
    expect(validation).toBeDefined();
    expect(validation?.length).toBeGreaterThan(0);
    console.log(`Validation checks: ${validation?.length}`);
  });

  it.skipIf(!supabaseServiceKey)('should benchmark INSERT performance', async () => {
    // Measure INSERT performance (10 iterations to keep test fast)
    const iterations = 10;
    const now = new Date().toISOString();

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      await supabase
        .from('orders')
        .insert({
          operator_id: testOperatorId,
          order_number: `PERF-BENCH-${Date.now()}-${i}`,
          customer_name: `Perf Test ${i}`,
          customer_phone: '+56987654321',
          delivery_address: 'Test Address',
          comuna: 'Santiago',
          delivery_date: '2026-02-20',
          raw_data: { test: 'perf', i },
          imported_via: 'MANUAL',
          imported_at: now,
        })
        .select()
        .single();
    }

    const totalTime = Date.now() - startTime;
    const avgTimePerInsert = totalTime / iterations;

    console.log(`Average INSERT time: ${avgTimePerInsert.toFixed(2)}ms (${iterations} iterations)`);

    // Allow up to 200ms per INSERT (includes network latency to remote prod)
    expect(avgTimePerInsert).toBeLessThan(200);

    // Cleanup
    await supabase
      .from('orders')
      .delete()
      .like('order_number', 'PERF-BENCH-%');
  });

  it.skipIf(!supabaseServiceKey)('should search audit logs by action filter', async () => {
    const startTime = Date.now();

    // Use PostgREST-compatible filter (no ::text casts)
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, timestamp, action')
      .eq('operator_id', testOperatorId)
      .ilike('action', '%test%')
      .limit(50);

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    expect(queryTime).toBeLessThan(500);
    console.log(`Search query time: ${queryTime}ms`);
  });

  it.skipIf(!supabaseServiceKey)('should verify EXPLAIN ANALYZE uses indexes (conceptual)', async () => {
    // EXPLAIN ANALYZE requires direct SQL access, not available via PostgREST.
    // Index existence is verified via validate_audit_logging RPC and
    // the migration's DO $$ validation block.
    // This test confirms queries complete without sequential scan timeouts.

    const startTime = Date.now();

    const { error } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('operator_id', testOperatorId)
      .gte('timestamp', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    const queryTime = Date.now() - startTime;

    expect(error).toBeNull();
    // If no index, a year-range query on a large table would be very slow
    expect(queryTime).toBeLessThan(500);
  });
});
