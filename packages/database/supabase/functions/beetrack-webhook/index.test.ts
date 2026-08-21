// Run with: `deno test packages/database/supabase/functions/beetrack-webhook/`
//
// CI (turbo + vitest) does not currently execute Deno tests in edge functions.
// This file is the manual regression seed for the dispatch→route upsert path.
import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  handleDispatch,
  packageStatusForDispatch,
  buildRouteUpsertRow,
  mergeDispatchRawData,
  resolveOperatorId,
  MUSAN_SLUG,
  PROVIDER,
} from './index.ts';

const OPERATOR_ID = '11111111-2222-4333-8444-555555555555';

Deno.test('buildRouteUpsertRow stamps the (operator,provider,external_route_id) conflict key', () => {
  const row = buildRouteUpsertRow(OPERATOR_ID, 43886285, { truck_driver: 'CAMILO J.' });

  // These three are the unique-conflict key for routes.upsert. Any drift here
  // means the upsert silently inserts duplicates instead of updating.
  assertEquals(row.operator_id, OPERATOR_ID);
  assertEquals(row.provider, PROVIDER);
  assertEquals(row.external_route_id, '43886285');
});

Deno.test('buildRouteUpsertRow carries driver_name when present in payload', () => {
  const row = buildRouteUpsertRow(OPERATOR_ID, 99, { truck_driver: 'JANE DOE' });
  assertEquals(row.driver_name, 'JANE DOE');
});

Deno.test('buildRouteUpsertRow defaults driver_name to null when absent', () => {
  const row = buildRouteUpsertRow(OPERATOR_ID, 99, {});
  assertEquals(row.driver_name, null);
});

Deno.test('buildRouteUpsertRow sets status=in_progress on discovery', () => {
  // handleRoute will refine this to completed when the route resource webhook
  // fires with ended=true; discovery via dispatch event only knows the route
  // is live, so in_progress is the safe starting value.
  const row = buildRouteUpsertRow(OPERATOR_ID, 99, {});
  assertEquals(row.status, 'in_progress');
});

Deno.test('buildRouteUpsertRow sets route_date to today (UTC, YYYY-MM-DD)', () => {
  const row = buildRouteUpsertRow(OPERATOR_ID, 99, {});
  const today = new Date().toISOString().split('T')[0];
  assertEquals(row.route_date, today);
});

Deno.test('buildRouteUpsertRow tags raw_data with discovery source', () => {
  // Lets us tell apart routes ingested via dispatch discovery from routes
  // populated by a real route-resource webhook payload later on.
  const row = buildRouteUpsertRow(OPERATOR_ID, 99, {});
  assertExists(row.raw_data);
  assertEquals((row.raw_data as Record<string, unknown>).discovered_via, 'dispatch_webhook');
});

Deno.test('buildRouteUpsertRow coerces numeric DT route id to string', () => {
  // external_route_id is text in the schema; storing 43886285 as number would
  // break the dispatches.external_route_id ↔ routes.external_route_id join.
  const row = buildRouteUpsertRow(OPERATOR_ID, 43886285, {});
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


// ── resolveOperatorId ────────────────────────────────────────────────────────
//
// The id used to be the literal production uuid. That row exists in production
// and nowhere else, so every QA write died on
// `23503 Key (operator_id)=(92dc5797-…) is not present in table "operators"`
// and DispatchTrack got a 500 for a guide it had just delivered.

function stubClient(row: { id: string } | null, error?: { message: string }) {
  return {
    from(_table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: error ?? null }),
      };
      return chain;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test('resolveOperatorId looks the operator up by slug', async () => {
  const id = await resolveOperatorId(stubClient({ id: 'qa-operator-id' }));
  assertEquals(id, 'qa-operator-id');
  assertEquals(MUSAN_SLUG, 'transportes-musan');
});

Deno.test('resolveOperatorId fails loudly when the operator is absent', async () => {
  // Better a 500 naming the missing operator than a foreign-key violation on
  // every table the handlers touch.
  let threw = false;
  try {
    await resolveOperatorId(stubClient(null));
  } catch (err) {
    threw = true;
    assertExists(String(err).match(/transportes-musan/));
  }
  assertEquals(threw, true);
});

// ── handleDispatch: writes ───────────────────────────────────────────────────
//
// Two defects the first live delivery exposed.
//
// 1. Duplicate dispatch rows. Dispatching a route writes a `dispatches` row
//    with no external_dispatch_id — DT's create-route response returns only a
//    route_id. The webhook upserts on
//    (operator_id, provider, external_dispatch_id), which can never match a
//    NULL, so it inserted a second row for the same order on the same route.
//
// 2. orders.status is a DERIVED column. trg_recalculate_order_status recomputes
//    it from the order's packages (MIN pipeline position) on every package
//    status change. Writing it directly left the order 'entregado' while its
//    packages sat at 'en_ruta', and the next package write would have reverted
//    it. The webhook must move the packages and let the trigger derive.

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: [string, unknown][];
}

function recordingClient(rows: Record<string, unknown[]>) {
  const calls: RecordedCall[] = [];

  function chainFor(table: string, op: string, payload?: unknown) {
    const call: RecordedCall = { table, op, payload, filters: [] };
    calls.push(call);
    const result = { data: (rows[table] ?? [])[0] ?? null, error: null };
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => { call.filters.push([col, val]); return chain; },
      neq: (col: string, val: unknown) => { call.filters.push([`neq:${col}`, val]); return chain; },
      is: (col: string, val: unknown) => { call.filters.push([`is:${col}`, val]); return chain; },
      in: (col: string, val: unknown) => { call.filters.push([`in:${col}`, val]); return chain; },
      limit: () => chain,
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select: () => chainFor(table, 'select'),
        upsert: (payload: unknown) => chainFor(table, 'upsert', payload),
        update: (payload: unknown) => chainFor(table, 'update', payload),
        insert: (payload: unknown) => chainFor(table, 'insert', payload),
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return { client, calls };
}

const DELIVERED_BODY = {
  resource: 'dispatch',
  event: 'update',
  identifier: 'CARGA-PARIS-002-ORD-110',
  route_id: 44181731,
  dispatch_id: 999000111,
  status: 2,
};

Deno.test('packageStatusForDispatch maps DT outcomes onto package states', () => {
  // 'entregado' and 'retorno_hub' are what the trigger reads: retorno_hub is
  // counted separately and yields en_retorno on the order.
  assertEquals(packageStatusForDispatch('delivered'), 'entregado');
  assertEquals(packageStatusForDispatch('failed'), 'retorno_hub');
  // A partial delivery does not say WHICH packages came back, so nothing moves.
  assertEquals(packageStatusForDispatch('partial'), null);
  assertEquals(packageStatusForDispatch('pending'), null);
});

Deno.test('handleDispatch adopts the row our own dispatch created', async () => {
  const { client, calls } = recordingClient({
    orders: [{ id: 'order-1' }],
    dispatches: [{ id: 'local-row', raw_data: {} }],
    routes: [{ id: 'route-uuid' }],
  });

  await handleDispatch(client, DELIVERED_BODY, 'op-1');

  const adoption = calls.find((c) =>
    c.table === 'dispatches' && c.op === 'update' &&
    (c.payload as Record<string, unknown>)?.external_dispatch_id === '999000111'
  );
  assertExists(adoption);
  // Adoption stamps the id on the existing row; the upsert that follows then
  // matches it on the conflict key instead of inserting a duplicate.
  assertEquals(adoption!.filters.some(([col]) => col === 'id'), true);
});

Deno.test('handleDispatch advances the packages, not orders.status', async () => {
  const { client, calls } = recordingClient({
    orders: [{ id: 'order-1' }],
    dispatches: [{ id: 'local-row', raw_data: {} }],
    routes: [{ id: 'route-uuid' }],
  });

  await handleDispatch(client, DELIVERED_BODY, 'op-1');

  const packageUpdate = calls.find((c) => c.table === 'packages' && c.op === 'update');
  assertExists(packageUpdate);
  assertEquals((packageUpdate!.payload as Record<string, unknown>).status, 'entregado');

  const orderUpdates = calls.filter((c) => c.table === 'orders' && c.op === 'update');
  for (const update of orderUpdates) {
    // status_detail is the order's own column; status is derived from packages.
    assertEquals('status' in (update.payload as Record<string, unknown>), false);
  }
});

Deno.test('handleDispatch still records why the order ended where it did', async () => {
  const { client, calls } = recordingClient({
    orders: [{ id: 'order-1' }],
    dispatches: [{ id: 'local-row', raw_data: {} }],
    routes: [{ id: 'route-uuid' }],
  });

  await handleDispatch(client, DELIVERED_BODY, 'op-1');

  const detail = calls.find((c) =>
    c.table === 'orders' && c.op === 'update' &&
    typeof (c.payload as Record<string, unknown>)?.status_detail === 'string'
  );
  assertExists(detail);
  assertExists(
    String((detail!.payload as Record<string, unknown>).status_detail).match(/999000111/),
  );
});
