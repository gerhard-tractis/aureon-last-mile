#!/usr/bin/env node
// Backfill missing Paris package rows from orders.raw_data.
// Reason: n8n UPSERT Packages was failing on duplicate (operator_id, label) batches,
// dropping all packages for the affected import. Each order's raw_data still holds the
// last-row CARTONID + SKU, which is enough to recover one package per order.

const SUPABASE_URL = 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE = 1000;
const BATCH = 500;

function isBlank(v) {
  return v == null || String(v).trim() === '';
}

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function postPackages(rows) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?on_conflict=operator_id,label`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`POST packages → ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`Backfill Paris packages — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  let offset = 0;
  let scanned = 0;
  let candidates = 0;
  let inserted = 0;
  let pages = 0;

  while (true) {
    const rows = await get(
      `orders?retailer_name=eq.Paris&select=id,operator_id,order_number,raw_data,packages(id)&deleted_at=is.null&order=imported_at.asc&limit=${PAGE}&offset=${offset}`,
    );
    if (rows.length === 0) break;
    pages += 1;
    scanned += rows.length;

    const toInsert = [];
    for (const o of rows) {
      if (Array.isArray(o.packages) && o.packages.length > 0) continue;
      const rd = o.raw_data || {};
      const carton = rd.CARTONID;
      if (isBlank(carton)) continue;
      candidates += 1;
      toInsert.push({
        operator_id: o.operator_id,
        order_id: o.id,
        label: String(carton).trim(),
        sku_items: [
          {
            sku: !isBlank(rd['Código del producto'])
              ? String(rd['Código del producto']).trim()
              : !isBlank(rd['Codigo del producto'])
                ? String(rd['Codigo del producto']).trim()
                : '',
            description: !isBlank(rd['Nombre del producto'])
              ? String(rd['Nombre del producto']).trim()
              : '',
          },
        ],
        raw_data: rd,
      });
    }

    console.log(
      `Page ${pages} (offset=${offset}): scanned=${rows.length}, missing-with-carton=${toInsert.length}`,
    );

    if (toInsert.length > 0 && !DRY_RUN) {
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        const result = await postPackages(slice);
        inserted += Array.isArray(result) ? result.length : 0;
      }
    }

    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  console.log('---');
  console.log(`Pages: ${pages}`);
  console.log(`Orders scanned: ${scanned}`);
  console.log(`Missing-with-CARTONID: ${candidates}`);
  console.log(`Inserted: ${inserted}${DRY_RUN ? ' (dry run — nothing posted)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
