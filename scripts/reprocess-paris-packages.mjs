import https from 'https';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('../apps/frontend/node_modules/xlsx');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';
const BASE = 'wfwlcpnkkxxzdvhvvsxb.supabase.co';
const OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const HEADERS = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

function getBytes(path) {
  return new Promise((res, rej) => {
    const chunks = [];
    https.get({ host: BASE, path, headers: HEADERS }, r => {
      r.on('data', c => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej);
  });
}

function getJSON(path) {
  return getBytes(path).then(b => JSON.parse(b.toString()));
}

function post(path, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request({
      host: BASE, path, method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation', 'Content-Length': Buffer.byteLength(data) }
    }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', rej);
    req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Download XLSX
  console.log('Downloading XLSX from Supabase Storage...');
  const xlsxBuf = await getBytes('/storage/v1/object/raw-files/musan/paris/2026-03-05/beetrack_export_1772740851680.xlsx');
  console.log('Downloaded', xlsxBuf.length, 'bytes');

  // 2. Parse
  const wb = XLSX.read(xlsxBuf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log('Rows in XLSX:', rows.length);
  if (rows.length > 0) console.log('Sample columns:', Object.keys(rows[0]).join(', '));

  // 3. Extract packages (one per carton row)
  const packages = [];
  let skipped = 0;
  for (const row of rows) {
    const orden = String(row['Orden'] || '').trim();
    const cartonId = String(row['CARTONID'] || '').trim();
    if (!orden || !cartonId) { skipped++; continue; }
    packages.push({
      order_number: orden,
      label: cartonId,
      sku: String(row['Código del producto'] || row['Codigo del producto'] || '').trim(),
      desc: String(row['Nombre del producto'] || '').trim(),
      raw: row
    });
  }
  console.log('Packages found:', packages.length, '| Rows without CARTONID:', skipped);

  if (packages.length === 0) {
    console.error('No packages with CARTONID found. Sample row:', JSON.stringify(rows[0]));
    process.exit(1);
  }

  // 4. Fetch today's Paris order IDs
  console.log('Fetching order IDs...');
  const orders = await getJSON(
    '/rest/v1/orders?select=id,order_number&operator_id=eq.' + OPERATOR_ID +
    '&retailer_name=eq.Paris&created_at=gte.2026-03-05T00:00:00&deleted_at=is.null'
  );
  const orderIds = {};
  for (const o of orders) orderIds[o.order_number] = o.id;
  console.log('Order IDs fetched:', orders.length);

  // 5. Link packages to order IDs
  const linked = [];
  const unmatched = new Set();
  for (const p of packages) {
    const orderId = orderIds[p.order_number];
    if (!orderId) { unmatched.add(p.order_number); continue; }
    linked.push({
      operator_id: OPERATOR_ID,
      order_id: orderId,
      label: p.label,
      sku_items: [{ sku: p.sku, description: p.desc }],
      raw_data: p.raw
    });
  }
  console.log('Linked packages:', linked.length, '| Unmatched orders:', [...unmatched].join(', ') || 'none');

  if (linked.length === 0) {
    console.error('No packages could be matched to orders');
    process.exit(1);
  }

  // 6. Upsert into packages table
  console.log('Upserting', linked.length, 'packages...');
  const result = await post('/rest/v1/packages', linked);
  if (result.status >= 400) {
    console.error('Upsert failed:', result.status, JSON.stringify(result.body));
    process.exit(1);
  }
  const count = Array.isArray(result.body) ? result.body.length : '?';
  console.log('✅ Done! Upsert status:', result.status, '| Packages upserted:', count);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
