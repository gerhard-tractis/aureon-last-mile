#!/usr/bin/env node
/**
 * Sync pending orders in Supabase with delivery status from:
 * 1. Our dispatches table (historical webhook data)
 * 2. DispatchTrack API — GET /api/external/v1/dispatches/:identifier
 *
 * Rate limit: 1,000 req/day, 1 req/sec. Script respects this.
 *
 * Usage: node scripts/sync-pending-orders.mjs [--dry-run] [--max-api=N]
 */

const SUPABASE_URL = 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';
const DT_BASE = 'https://transportesmusan.dispatchtrack.com';
const DT_API_KEY = '998d3378655743ca3b6506817274bad71714916d2bddacf9d094a2e35c805807';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_API = (() => {
  const arg = process.argv.find(a => a.startsWith('--max-api='));
  return arg ? parseInt(arg.split('=')[1], 10) : 950; // leave 50 buffer
})();

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

async function supabasePatch(table, filters, body) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH: ${res.status} ${await res.text()}`);
  return res.json();
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

async function updateOrder(order, newStatus, statusDetail) {
  if (DRY_RUN) return true;
  try {
    await supabasePatch('orders', { id: `eq.${order.id}` }, {
      status: newStatus,
      status_detail: statusDetail,
    });
    return true;
  } catch (err) {
    console.error(`   ERR ${order.order_number}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`=== Sync Pending Orders ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} | max API calls: ${MAX_API} ===\n`);

  // ── Step 1: Fetch all pending orders ────────────────────────────────
  console.log('1. Fetching all pending orders from Supabase...');
  const pendingOrders = await fetchAllPaginated(
    'orders?select=id,order_number,delivery_date,customer_name,status&status=eq.pending&deleted_at=is.null&order=delivery_date.asc'
  );
  console.log(`   ${pendingOrders.length} pending orders\n`);
  if (pendingOrders.length === 0) { console.log('Nothing to do.'); return; }

  const pendingById = new Map(pendingOrders.map(o => [o.id, o]));

  // ── Step 2: Fix from dispatches table first (free, no API calls) ───
  console.log('2. Checking dispatches table for unsynced terminal dispatches...');
  const terminalDispatches = await fetchAllPaginated(
    'dispatches?select=id,external_dispatch_id,order_id,status,substatus,completed_at&status=in.(delivered,failed,partial)&order_id=not.is.null&deleted_at=is.null'
  );

  let dbFixed = 0;
  const fixedIds = new Set();
  for (const d of terminalDispatches) {
    const order = pendingById.get(d.order_id);
    if (!order) continue;

    const newStatus = d.status === 'delivered' ? 'delivered' : 'failed';
    const detail = d.substatus
      ? `${d.substatus} (dispatch ${d.external_dispatch_id}, backfill)`
      : `${newStatus} via dispatch ${d.external_dispatch_id} (backfill)`;

    const ok = await updateOrder(order, newStatus, detail);
    if (ok) {
      dbFixed++;
      fixedIds.add(order.id);
      console.log(`   DB ${order.order_number} → ${newStatus}`);
    }
  }
  console.log(`   Fixed from DB: ${dbFixed}\n`);

  // ── Step 3: Query DispatchTrack API for remaining ──────────────────
  const remaining = pendingOrders.filter(o => !fixedIds.has(o.id));
  console.log(`3. Querying DispatchTrack API for ${remaining.length} remaining orders (max ${MAX_API} calls)...`);

  let apiCalls = 0;
  let apiDelivered = 0;
  let apiFailed = 0;
  let apiNotFound = 0;
  let apiOnRoute = 0;
  let apiErrors = 0;

  for (const order of remaining) {
    if (apiCalls >= MAX_API) {
      console.log(`\n   Rate limit reached (${MAX_API} calls). ${remaining.length - apiCalls} orders remaining — run again tomorrow.`);
      break;
    }

    try {
      const dt = await dtLookupDispatch(order.order_number);
      apiCalls++;

      if (!dt || (Array.isArray(dt) && dt.length === 0)) {
        apiNotFound++;
      } else {
        // API may return array or single object
        const dispatches = Array.isArray(dt) ? dt : [dt];
        // Find the most terminal status (delivered > failed > partial > pending)
        const delivered = dispatches.find(d => d.status_id === 2);
        const failed = dispatches.find(d => d.status_id === 3 || d.status_id === 4);
        const onRoute = dispatches.find(d => d.status_id === 1);

        if (delivered) {
          const detail = `${delivered.substatus || 'Delivered'} via DispatchTrack dispatch #${delivered.dispatch_id} (API backfill)`;
          const ok = await updateOrder(order, 'delivered', detail);
          if (ok) apiDelivered++;
          console.log(`   API ${order.order_number} (${order.customer_name}) → delivered [${delivered.substatus || ''}]`);
        } else if (failed) {
          const detail = failed.substatus || `Failed via DispatchTrack dispatch #${failed.dispatch_id} (API backfill)`;
          const ok = await updateOrder(order, 'failed', detail);
          if (ok) apiFailed++;
          console.log(`   API ${order.order_number} (${order.customer_name}) → failed [${failed.substatus || ''}]`);
        } else if (onRoute) {
          apiOnRoute++;
        } else {
          apiNotFound++;
        }
      }

      // Progress every 50
      if (apiCalls % 50 === 0) {
        console.log(`   ... ${apiCalls}/${Math.min(remaining.length, MAX_API)} calls | delivered=${apiDelivered} failed=${apiFailed} on_route=${apiOnRoute} not_found=${apiNotFound}`);
      }

      // Respect 1 req/sec rate limit
      await sleep(1100);
    } catch (err) {
      apiCalls++;
      apiErrors++;
      console.error(`   ERR ${order.order_number}: ${err.message}`);
      await sleep(1100);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY ===`);
  console.log(`Fixed from DB:        ${dbFixed}`);
  console.log(`API calls made:       ${apiCalls}`);
  console.log(`API → delivered:      ${apiDelivered}`);
  console.log(`API → failed:         ${apiFailed}`);
  console.log(`API → on_route:       ${apiOnRoute}`);
  console.log(`API → not found in DT:${apiNotFound}`);
  console.log(`API errors:           ${apiErrors}`);
  console.log(`Remaining:            ${remaining.length - apiCalls}`);
  if (DRY_RUN) console.log(`\nDRY RUN — no changes were made.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
