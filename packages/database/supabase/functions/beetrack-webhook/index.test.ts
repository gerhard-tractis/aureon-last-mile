// Run with: `deno test packages/database/supabase/functions/beetrack-webhook/`
//
// CI (turbo + vitest) does not currently execute Deno tests in edge functions.
// This file is the manual regression seed for the dispatch→route upsert path.
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { buildRouteUpsertRow, mergeDispatchRawData, MUSAN_OPERATOR_ID, PROVIDER } from './index.ts';

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


// ─── mergeDispatchRawData ─────────────────────────────────────────────────
// DispatchTrack sends the full payload (with items[]) on the dispatch CREATE
// event and only the changed fields on UPDATE events. The webhook used to
// overwrite raw_data on every event, so an update body without items[] would
// strip the items the create body carried. Reproduced 2026-06-01 for DT route
// 43890304: 4 of 8 dispatches had no items in raw_data because only update
// events were observed for them after the initial create was overwritten.

Deno.test('mergeDispatchRawData preserves items from the existing payload when incoming omits them', () => {
  const existing = {
    event: 'create',
    identifier: '2917997969',
    items: [
      { code: '1351410', name: 'CLOSET', quantity: 2 },
      { code: '1492034', name: 'KIT COCINA', quantity: 1 },
    ],
  };
  const incoming = {
    event: 'update',
    identifier: '2917997969',
    status: 2,
    // no items[] — DT update event
  };
  const merged = mergeDispatchRawData(existing, incoming);
  assertEquals(
    (merged.items as unknown[]).length,
    2,
    'items from existing must be preserved when incoming has none',
  );
  assertEquals(merged.event, 'update', 'scalar fields take the incoming value');
  assertEquals(merged.status, 2, 'new fields from incoming are added');
});

Deno.test('mergeDispatchRawData prefers incoming items when both have items', () => {
  const existing = { items: [{ code: 'OLD', quantity: 1 }] };
  const incoming = { items: [{ code: 'NEW', quantity: 5 }] };
  const merged = mergeDispatchRawData(existing, incoming);
  assertEquals(
    ((merged.items as Record<string, unknown>[])[0]).code,
    'NEW',
    'newer items win',
  );
});

Deno.test('mergeDispatchRawData handles null/undefined existing as a fresh insert', () => {
  const incoming = { event: 'create', items: [{ code: 'X', quantity: 1 }] };
  assertEquals(mergeDispatchRawData(null, incoming), incoming);
  assertEquals(mergeDispatchRawData(undefined, incoming), incoming);
});

Deno.test('mergeDispatchRawData copies through other scalar fields from incoming', () => {
  const existing = { event: 'create', identifier: 'X', status: 1 };
  const incoming = { event: 'update', identifier: 'X', status: 2, position: 7 };
  const merged = mergeDispatchRawData(existing, incoming);
  assertEquals(merged.status, 2);
  assertEquals(merged.position, 7);
  assertEquals(merged.identifier, 'X');
});

Deno.test('mergeDispatchRawData treats empty items array on incoming as "preserve existing"', () => {
  // Some DT update payloads include `items: []` rather than omitting the key.
  // We must treat both shapes the same — an empty incoming items[] is not a
  // statement that "the order is empty", it's a side-effect of the update
  // event format.
  const existing = { items: [{ code: 'A', quantity: 1 }] };
  const incoming = { event: 'update', items: [] };
  const merged = mergeDispatchRawData(existing, incoming);
  assertEquals(
    ((merged.items as unknown[]).length),
    1,
    'existing items survive an incoming empty items[]',
  );
});
