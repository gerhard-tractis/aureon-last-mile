#!/usr/bin/env node
/**
 * Replay verification script for the Easy WMS webhook (spec-49 Story 4).
 *
 * Posts a stored raw payload file to a target n8n webhook URL with
 * Content-Type: application/x-www-form-urlencoded (reproducing Easy's real,
 * wrong content type), then queries orders in Supabase and asserts each
 * dispatch_guide_url is byte-identical to the url_guia in the source file.
 *
 * Usage:
 *   node scripts/replay-easy-webhook.mjs --payload <path> --webhook <url> [--skip-post] [--wait <seconds>] [--allow-prod]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (required)
 *   EASY_WMS_WEBHOOK_TOKEN (required unless --skip-post)
 *   PROD_N8N_HOST (optional guard rail — see checkNotProd)
 *
 * See docs/specs/spec-49-easy-webhook-dispatch-guide-url.md Design §4 and Story 4.
 */

import { readFileSync } from 'node:fs';

const MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';

function parseArgs(argv) {
  const args = { skipPost: false, wait: 10, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--payload') args.payload = argv[++i];
    else if (a === '--webhook') args.webhook = argv[++i];
    else if (a === '--skip-post') args.skipPost = true;
    else if (a === '--wait') {
      const raw = argv[++i];
      const parsed = raw === undefined ? NaN : parseFloat(raw);
      if (Number.isNaN(parsed)) {
        console.error(`Invalid --wait value: ${JSON.stringify(raw)} (expected a number of seconds)`);
        process.exit(1);
      }
      args.wait = parsed;
    } else if (a === '--allow-prod') args.allowProd = true;
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Reads the raw payload file and recovers the despachos list for the assertion phase.
// The file may be stored as either clean Easy JSON, or the mangled single/multi-key
// form object shape (as it would be captured from n8n's form parser). Returns the raw
// file bytes as a Buffer (posted untouched) plus the recovered payload used only for
// building the expectation oracle.
function loadPayloadFile(path) {
  const rawBuf = readFileSync(path); // Buffer — no encoding applied, bytes untouched
  const raw = rawBuf.toString('utf8'); // decode only for parsing/assertion, never for POST body

  // Try clean JSON first (covers both {evento, despachos} and a bare mangled object
  // serialized as JSON, e.g. {"key": "value", ...}).
  let asJson;
  try {
    asJson = JSON.parse(raw);
  } catch {
    // Raw file is not JSON at all — treat the whole content as a raw form-encoded string
    // and reconstruct it exactly like parseEasyWmsBody's path 3 in easy-wms-map.test.ts.
    const { payload, reconstructed } = reconstructFormString(raw);
    return { rawBytes: rawBuf, payload, reconstructed };
  }

  if (asJson && typeof asJson === 'object' && !Array.isArray(asJson)) {
    if (Array.isArray(asJson.despachos)) {
      return { rawBytes: rawBuf, payload: asJson, reconstructed: false };
    }
    // Mangled form object stored as JSON (e.g. {"{\"evento\":...": ""}).
    const keys = Object.keys(asJson);
    if (keys.length > 0 && keys[0].startsWith('{')) {
      const reconstructedStr = Object.entries(asJson)
        .map(([k, v]) => (v === '' ? k : k + '=' + v))
        .join('&');
      return { rawBytes: rawBuf, payload: JSON.parse(reconstructedStr), reconstructed: true };
    }
  }

  throw new Error('Payload file is neither clean Easy JSON nor the mangled form-parse shape');
}

// Mirrors parseEasyWmsBody's path 3 reconstruction from apps/worker/src/connectors/easy-wms-map.test.ts —
// keep this in sync with that file (and the n8n Code node) if the reconstruction logic changes.
function reconstructFormString(rawFormBody) {
  const obj = {};
  for (const segment of rawFormBody.split('&')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx === -1) obj[segment] = '';
    else obj[segment.slice(0, eqIdx)] = segment.slice(eqIdx + 1);
  }
  const keys = Object.keys(obj);
  if (keys.length > 0 && keys[0].startsWith('{')) {
    const reconstructed = Object.entries(obj)
      .map(([k, v]) => (v === '' ? k : k + '=' + v))
      .join('&');
    return { payload: JSON.parse(reconstructed), reconstructed: true };
  }

  throw new Error('Unable to parse payload file: neither clean JSON nor the mangled form-parse shape');
}

// Mirrors parseDeliveryDate from apps/worker/src/connectors/easy-wms-map.test.ts — a despacho
// with neither a valid fecha_compromiso nor fecha_carga is skipped by mapDespachos, so it must
// not seed an expectation here either. Keep this regex in sync with that file.
function hasValidDeliveryDate(despacho) {
  const fc = (despacho.fecha_compromiso || '').trim();
  if (fc && /^\d{4}-\d{2}-\d{2}$/.test(fc)) return true;
  const fca = (despacho.fecha_carga || '').trim();
  if (fca && /^\d{4}-\d{2}-\d{2}$/.test(fca)) return true;
  return false;
}

// First VALID despacho per entrega wins (mapDespachos skips despachos with no valid delivery
// date entirely before the first-wins map.set), matching mapDespachos (spec-49 Design
// §2/Error handling). An entrega whose despachos ALL fail the delivery-date check yields
// `expectAbsent: true` — mapDespachos never creates an order for it, so a missing order in
// the DB is the correct outcome (PASS), not a mismatch.
// Caveat: run against a fresh/QA DB. Replaying over pre-existing data yields false FAILs —
// an order created by an earlier import trips expectAbsent, and the null-overwrite trigger
// preserves an older stored URL when the replayed payload carries no url_guia.
function expectedUrlsByEntrega(payload) {
  const byEntrega = new Map(); // entrega -> despacho[] in payload order
  for (const despacho of payload.despachos || []) {
    const entrega = (despacho.entrega || '').trim();
    if (!entrega) continue;
    if (!byEntrega.has(entrega)) byEntrega.set(entrega, []);
    byEntrega.get(entrega).push(despacho);
  }

  const expected = new Map();
  for (const [entrega, despachos] of byEntrega.entries()) {
    const firstValid = despachos.find(hasValidDeliveryDate);
    if (firstValid) {
      expected.set(entrega, { url: firstValid.url_guia || null, expectAbsent: false });
    } else {
      expected.set(entrega, { url: null, expectAbsent: true });
    }
  }
  return expected;
}

function checkNotProd(webhookUrl, allowProd) {
  const prodHost = process.env.PROD_N8N_HOST;
  if (!prodHost) {
    console.log('Reminder: PROD_N8N_HOST is not set — cannot verify this is not a prod replay. Prod replays require explicit user instruction.');
    return;
  }
  if (webhookUrl.includes(prodHost) && !allowProd) {
    console.error(`Refusing to POST to a URL containing the prod n8n host (${prodHost}). Pass --allow-prod to override.`);
    process.exit(1);
  }
}

async function postPayload(webhookUrl, rawBytes, token) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Token: token,
    },
    body: rawBytes,
  });
  const bodyText = await res.text();
  console.log(`POST ${webhookUrl} -> ${res.status}`);
  console.log(`Response body: ${bodyText}`);
  return { ok: res.ok, status: res.status, bodyText };
}

async function fetchOrder(supabaseUrl, serviceKey, entrega) {
  const qs = `order_number=eq.${encodeURIComponent(entrega)}&operator_id=eq.${MUSAN_OPERATOR_ID}&deleted_at=is.null&select=order_number,dispatch_guide_url`;
  const res = await fetch(`${supabaseUrl}/rest/v1/orders?${qs}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase GET failed for entrega ${entrega}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function runAssertions(supabaseUrl, serviceKey, expected) {
  const rows = [];
  let allPass = true;

  for (const [entrega, exp] of expected.entries()) {
    const expectedDisplay = exp.expectAbsent ? '(expected absent — no valid delivery date)' : exp.url;
    let status;
    let actualUrl = null;
    try {
      const orders = await fetchOrder(supabaseUrl, serviceKey, entrega);
      if (orders.length === 0) {
        actualUrl = '(missing order)';
        // No valid despacho for this entrega means mapDespachos never creates an order —
        // a missing row is the expected, correct outcome, not a failure.
        status = exp.expectAbsent ? 'PASS' : 'FAIL';
      } else {
        actualUrl = orders[0].dispatch_guide_url;
        status = exp.expectAbsent ? 'FAIL' : actualUrl === exp.url ? 'PASS' : 'FAIL';
      }
    } catch (err) {
      status = 'FAIL';
      actualUrl = `(error: ${err.message})`;
    }
    if (status === 'FAIL') allPass = false;
    rows.push({ entrega, expectedUrl: expectedDisplay, actualUrl, status });
  }

  console.log('\nentrega               | status | expected -> actual');
  console.log('-----------------------|--------|--------------------');
  for (const r of rows) {
    console.log(`${r.entrega.padEnd(23)}| ${r.status.padEnd(7)}| ${JSON.stringify(r.expectedUrl)} -> ${JSON.stringify(r.actualUrl)}`);
  }

  const passCount = rows.filter((r) => r.status === 'PASS').length;
  console.log(`\nSummary: ${passCount}/${rows.length} PASS`);

  return allPass;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.payload) {
    console.error('Missing required --payload <path>');
    process.exit(1);
  }
  if (!args.skipPost && !args.webhook) {
    console.error('Missing required --webhook <url> (or pass --skip-post)');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
  }

  const { rawBytes, payload, reconstructed } = loadPayloadFile(args.payload);
  console.log(`Loaded payload file: ${args.payload} (${rawBytes.length} bytes, reconstructed=${reconstructed})`);

  const expected = expectedUrlsByEntrega(payload);
  console.log(`Found ${expected.size} unique entrega(s) to verify.`);

  if (!args.skipPost) {
    const token = process.env.EASY_WMS_WEBHOOK_TOKEN;
    if (!token) {
      console.error('Missing EASY_WMS_WEBHOOK_TOKEN env var (required unless --skip-post).');
      process.exit(1);
    }
    checkNotProd(args.webhook, args.allowProd);
    const postResult = await postPayload(args.webhook, rawBytes, token);
    if (!postResult.ok) {
      console.error(`Webhook rejected the post: HTTP ${postResult.status}. Aborting before assertion phase.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Waiting ${args.wait}s before assertion phase...`);
    await sleep(args.wait * 1000);
  } else {
    console.log('--skip-post: skipping POST, running assertion phase only.');
  }

  const allPass = await runAssertions(supabaseUrl, serviceKey, expected);
  // Use exitCode (not process.exit()) so pending fetch/undici sockets drain
  // naturally instead of triggering a hard-exit crash on some Node/Windows builds.
  process.exitCode = allPass ? 0 : 1;
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exitCode = 1;
});
