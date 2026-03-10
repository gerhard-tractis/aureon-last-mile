#!/usr/bin/env node
/**
 * Backfill dispatches table by querying DispatchTrack Show Dispatch endpoint
 * for every order that has no dispatch record.
 *
 * Uses GET /api/external/v1/dispatches/:identifier (by order_number)
 * Rate limit: 1,000 req/day, 1 req/sec
 *
 * Usage: node scripts/backfill-dispatches-by-order.mjs [--dry-run] [--max-api=N]
 */

const SUPABASE_URL = 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';
const DT_BASE = 'https://transportesmusan.dispatchtrack.com';
const DT_API_KEY = '998d3378655743ca3b6506817274bad71714916d2bddacf9d094a2e35c805807';
const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const PROVIDER = 'dispatchtrack';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_API = (() => {
  const arg = process.argv.find(a => a.startsWith('--max-api='));
  return arg ? parseInt(arg.split('=')[1], 10) : 380;
})();

const STATUS_MAP = { 1: 'pending', 2: 'delivered', 3: 'failed', 4: 'partial' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchAll(path, pageSize = 1000) {
  const all = [];
  let offset = 0;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await sbGet(`${path}${sep}offset=${offset}&limit=${pageSize}`);
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function supabaseUpsert(table, rows, onConflict) {
  const qs = onConflict ? `?on_conflict=${onConflict}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table}: ${res.status} ${await res.text()}`);
}

async function supabaseRpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function dtLookupDispatch(identifier) {
  const res = await fetch(`${DT_BASE}/api/external/v1/dispatches/${identifier}`, {
    headers: { 'X-AUTH-TOKEN': DT_API_KEY },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`DT ${identifier}: ${res.status}`);
  }
  const data = await res.json();
  if (data.status === 'error') return null;
  return data.response || null;
}

function mapDtToDispatchRow(d, orderId) {
  const status = STATUS_MAP[d.status_id];
  if (!status) return null;

  const failureReason = status === 'failed' && d.substatus ? d.substatus : null;

  return {
    operator_id: MUSAN_OPERATOR_ID,
    provider: PROVIDER,
    external_dispatch_id: String(d.dispatch_id),
    external_route_id: d.route_id != null ? String(d.route_id) : null,
    order_id: orderId,
    status,
    substatus: d.substatus || null,
    substatus_code: d.substatus_code || null,
    planned_sequence: d.position || null,
    estimated_at: d.estimated_at || null,
    arrived_at: d.arrived_at || null,
    completed_at: d.arrived_at || null,
    failure_reason: failureReason,
    is_pickup: d.is_pickup || false,
    latitude: d.latitude ? parseFloat(d.latitude) : null,
    longitude: d.longitude ? parseFloat(d.longitude) : null,
    raw_data: d,
  };
}

async function main() {
  console.log(`=== Backfill Dispatches by Order ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} | max API: ${MAX_API} ===\n`);

  // Step 1: Get all orders
  console.log('1. Fetching all orders from Supabase...');
  const allOrders = await fetchAll('orders?select=id,order_number,delivery_date&deleted_at=is.null&order=delivery_date.asc');
  console.log(`   ${allOrders.length} orders\n`);

  // Step 2: Get order_ids that already have dispatches
  console.log('2. Fetching existing dispatches...');
  const dispatches = await fetchAll('dispatches?select=order_id&order_id=not.is.null&deleted_at=is.null');
  const orderIdsWithDispatch = new Set(dispatches.map(d => d.order_id));
  console.log(`   ${orderIdsWithDispatch.size} orders already have dispatches\n`);

  // Step 3: Filter to orders without dispatches
  const needsDispatch = allOrders.filter(o => !orderIdsWithDispatch.has(o.id));
  console.log(`3. ${needsDispatch.length} orders need dispatch lookup\n`);

  if (needsDispatch.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  // Step 4: Query DT API for each order
  console.log(`4. Querying DispatchTrack API (max ${MAX_API} calls)...`);
  let apiCalls = 0;
  let created = 0;
  let notFound = 0;
  let errors = 0;
  const affectedDates = new Set();
  const dispatchBatch = [];

  for (const order of needsDispatch) {
    if (apiCalls >= MAX_API) {
      console.log(`\n   Quota limit reached (${MAX_API} calls). ${needsDispatch.length - apiCalls} orders remaining — run again tomorrow.`);
      break;
    }

    try {
      const dt = await dtLookupDispatch(order.order_number);
      apiCalls++;

      if (!dt || (Array.isArray(dt) && dt.length === 0)) {
        notFound++;
      } else {
        const dtList = Array.isArray(dt) ? dt : [dt];
        for (const d of dtList) {
          const row = mapDtToDispatchRow(d, order.id);
          if (row) {
            dispatchBatch.push(row);
            affectedDates.add(order.delivery_date);
            created++;
          }
        }
      }

      if (apiCalls % 50 === 0) {
        console.log(`   ${apiCalls}/${Math.min(needsDispatch.length, MAX_API)} calls | dispatches=${created} not_found=${notFound} errors=${errors}`);

        // Flush batch every 50 calls
        if (!DRY_RUN && dispatchBatch.length > 0) {
          try {
            await supabaseUpsert('dispatches', dispatchBatch, 'operator_id,provider,external_dispatch_id');
          } catch (err) {
            console.error(`   Upsert error: ${err.message}`);
          }
          dispatchBatch.length = 0;
        }
      }

      await sleep(1100);
    } catch (err) {
      apiCalls++;
      errors++;
      console.error(`   ERR ${order.order_number}: ${err.message}`);
      await sleep(1100);
    }
  }

  // Flush remaining batch
  if (!DRY_RUN && dispatchBatch.length > 0) {
    try {
      await supabaseUpsert('dispatches', dispatchBatch, 'operator_id,provider,external_dispatch_id');
    } catch (err) {
      console.error(`   Final upsert error: ${err.message}`);
    }
  }

  console.log(`\n   API calls: ${apiCalls} | dispatches created: ${created} | not found: ${notFound} | errors: ${errors}\n`);

  // Step 5: Recalculate metrics for affected dates
  if (!DRY_RUN && affectedDates.size > 0) {
    const sortedDates = [...affectedDates].sort();
    console.log(`5. Recalculating daily metrics for ${sortedDates.length} dates...`);
    for (const date of sortedDates) {
      try {
        await supabaseRpc('calculate_daily_metrics', { p_date: date });
        console.log(`   OK ${date}`);
      } catch (err) {
        console.error(`   ERR ${date}: ${err.message}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Orders without dispatches: ${needsDispatch.length}`);
  console.log(`API calls made:           ${apiCalls}`);
  console.log(`Dispatch rows created:    ${created}`);
  console.log(`Not found in DT:          ${notFound}`);
  console.log(`Errors:                   ${errors}`);
  console.log(`Remaining:                ${needsDispatch.length - apiCalls}`);
  if (DRY_RUN) console.log(`\nDRY RUN — no changes were made.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
