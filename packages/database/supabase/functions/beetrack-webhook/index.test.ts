// Run with: `deno test packages/database/supabase/functions/beetrack-webhook/`
//
// CI (turbo + vitest) does not currently execute Deno tests in edge functions.
// This file is the manual regression seed for the dispatch→route upsert path.
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { buildRouteUpsertRow, MUSAN_OPERATOR_ID, PROVIDER } from './index.ts';

Deno.test('buildRouteUpsertRow stamps the (operator,provider,external_route_id) conflict key', () => {
  const row = buildRouteUpsertRow(43886285, { truck_driver: 'CAMILO J.' });

  // These three are the unique-conflict key for routes.upsert. Any drift here
  // means the upsert silently inserts duplicates instead of updating.
  assertEquals(row.operator_id, MUSAN_OPERATOR_ID);
  assertEquals(row.provider, PROVIDER);
  assertEquals(row.external_route_id, '43886285');
});

Deno.test('buildRouteUpsertRow carries driver_name when present in payload', () => {
  const row = buildRouteUpsertRow(99, { truck_driver: 'JANE DOE' });
  assertEquals(row.driver_name, 'JANE DOE');
});

Deno.test('buildRouteUpsertRow defaults driver_name to null when absent', () => {
  const row = buildRouteUpsertRow(99, {});
  assertEquals(row.driver_name, null);
});

Deno.test('buildRouteUpsertRow sets status=in_progress on discovery', () => {
  // handleRoute will refine this to completed when the route resource webhook
  // fires with ended=true; discovery via dispatch event only knows the route
  // is live, so in_progress is the safe starting value.
  const row = buildRouteUpsertRow(99, {});
  assertEquals(row.status, 'in_progress');
});

Deno.test('buildRouteUpsertRow sets route_date to today (UTC, YYYY-MM-DD)', () => {
  const row = buildRouteUpsertRow(99, {});
  const today = new Date().toISOString().split('T')[0];
  assertEquals(row.route_date, today);
});

Deno.test('buildRouteUpsertRow tags raw_data with discovery source', () => {
  // Lets us tell apart routes ingested via dispatch discovery from routes
  // populated by a real route-resource webhook payload later on.
  const row = buildRouteUpsertRow(99, {});
  assertExists(row.raw_data);
  assertEquals((row.raw_data as Record<string, unknown>).discovered_via, 'dispatch_webhook');
});

Deno.test('buildRouteUpsertRow coerces numeric DT route id to string', () => {
  // external_route_id is text in the schema; storing 43886285 as number would
  // break the dispatches.external_route_id ↔ routes.external_route_id join.
  const row = buildRouteUpsertRow(43886285, {});
  assertEquals(typeof row.external_route_id, 'string');
  assertEquals(row.external_route_id, '43886285');
});
