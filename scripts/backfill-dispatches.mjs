#!/usr/bin/env node
/**
 * Backfill dispatches table from DispatchTrack API (Filter Dispatches endpoint).
 * Uses GET /api/external/v1/dispatches?s=START&e=END&page=N
 *
 * This populates the dispatches table so calculate_daily_metrics can correctly
 * count delivered/failed orders for the dashboard.
 *
 * Usage: node scripts/backfill-dispatches.mjs [--dry-run] [--max-pages=N]
 */

const SUPABASE_URL = 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';
const DT_BASE = 'https://transportesmusan.dispatchtrack.com';
const DT_API_KEY = '998d3378655743ca3b6506817274bad71714916d2bddacf9d094a2e35c805807';
const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const PROVIDER = 'dispatchtrack';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_PAGES = (() => {
  const arg = process.argv.find(a => a.startsWith('--max-pages='));
  return arg ? parseInt(arg.split('=')[1], 10) : 950;
})();

// DispatchTrack status_id → dispatch_status_enum
const STATUS_MAP = { 1: 'pending', 2: 'delivered', 3: 'failed', 4: 'partial' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase GET: ${res.status} ${await res.text()}`);
  return res.json();
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

async function fetchAllPaginated(path, pageSize = 1000) {
  const all = [];
  let offset = 0;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await supabaseGet(`${path}${sep}offset=${offset}&limit=${pageSize}`);
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function main() {
  console.log(`=== Backfill Dispatches ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} | max pages: ${MAX_PAGES} ===\n`);

  // ── Step 1: Build order lookup ──────────────────────────────────────
  console.log('1. Fetching all orders from Supabase...');
  const allOrders = await fetchAllPaginated(
    'orders?select=id,order_number,delivery_date&deleted_at=is.null'
  );
  const ordersByNumber = new Map(allOrders.map(o => [o.order_number, o]));
  console.log(`   ${allOrders.length} orders loaded\n`);

  // ── Step 2: Fetch all dispatches from DT API ───────────────────────
  console.log('2. Fetching dispatches from DispatchTrack API (Feb 14 → today)...');
  const dtDispatches = [];
  const seen = new Set();
  let page = 1;
  let apiCalls = 0;

  while (apiCalls < MAX_PAGES) {
    const res = await fetch(
      `${DT_BASE}/api/external/v1/dispatches?s=2026-02-14&e=2026-03-09&page=${page}`,
      { headers: { 'X-AUTH-TOKEN': DT_API_KEY } }
    );
    apiCalls++;

    if (!res.ok) {
      console.error(`   Page ${page}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    const dispatches = data.response || [];
    if (dispatches.length === 0) break;

    let newCount = 0;
    for (const d of dispatches) {
      if (!seen.has(d.dispatch_id)) {
        seen.add(d.dispatch_id);
        dtDispatches.push(d);
        newCount++;
      }
    }

    if (page % 50 === 0) {
      console.log(`   Page ${page}: ${dtDispatches.length} unique dispatches (${apiCalls} API calls)`);
    }

    if (dispatches.length < 25) break;
    page++;
    await sleep(1100);
  }

  const dtStatusCounts = {};
  dtDispatches.forEach(d => { dtStatusCounts[d.status] = (dtStatusCounts[d.status] || 0) + 1; });
  console.log(`\n   Total: ${dtDispatches.length} unique dispatches in ${apiCalls} API calls`);
  console.log(`   Statuses: ${JSON.stringify(dtStatusCounts)}\n`);

  // ── Step 3: Map to dispatch rows ───────────────────────────────────
  console.log('3. Mapping to dispatch rows...');
  const affectedDates = new Set();
  let matched = 0;
  let unmatched = 0;
  const dispatchRows = [];

  for (const d of dtDispatches) {
    const status = STATUS_MAP[d.status_id];
    if (!status) continue;

    // Lookup order
    let orderId = null;
    if (d.identifier) {
      const order = ordersByNumber.get(d.identifier);
      if (order) {
        orderId = order.id;
        affectedDates.add(order.delivery_date);
        matched++;
      } else {
        unmatched++;
      }
    }

    const failureReason = status === 'failed' && d.substatus ? d.substatus : null;

    dispatchRows.push({
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
      completed_at: d.arrived_at || null, // DT uses arrived_at as completion time
      failure_reason: failureReason,
      is_pickup: d.is_pickup || false,
      latitude: d.latitude ? parseFloat(d.latitude) : null,
      longitude: d.longitude ? parseFloat(d.longitude) : null,
      raw_data: d,
    });
  }

  console.log(`   ${dispatchRows.length} dispatch rows prepared`);
  console.log(`   ${matched} matched to orders, ${unmatched} unmatched`);
  console.log(`   ${affectedDates.size} unique delivery dates affected\n`);

  if (DRY_RUN) {
    console.log('DRY RUN — would upsert these dispatches and recalculate metrics.');
    console.log(`Affected dates: ${[...affectedDates].sort().join(', ')}`);
    return;
  }

  // ── Step 4: Upsert dispatches in batches ───────────────────────────
  console.log('4. Upserting dispatches into Supabase (batches of 50)...');
  const batchSize = 50;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < dispatchRows.length; i += batchSize) {
    const batch = dispatchRows.slice(i, i + batchSize);
    try {
      await supabaseUpsert('dispatches', batch, 'operator_id,provider,external_dispatch_id');
      upserted += batch.length;
      if ((i / batchSize) % 20 === 0) {
        console.log(`   ${upserted}/${dispatchRows.length} upserted`);
      }
    } catch (err) {
      errors += batch.length;
      console.error(`   Batch error at ${i}: ${err.message}`);
    }
  }
  console.log(`   Done: ${upserted} upserted, ${errors} errors\n`);

  // ── Step 5: Recalculate daily metrics ──────────────────────────────
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

  console.log(`\n=== SUMMARY ===`);
  console.log(`DT API calls:    ${apiCalls}`);
  console.log(`Dispatches found: ${dtDispatches.length}`);
  console.log(`Upserted:        ${upserted}`);
  console.log(`Metrics recalced: ${sortedDates.length} dates`);
  console.log(`Errors:          ${errors}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
