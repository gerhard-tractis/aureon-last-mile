#!/usr/bin/env node
// Re-triggers DispatchTrack XLSX exports for missing days. The resulting
// emails land on contacto@transportesmusan.com and the existing n8n IMAP
// trigger imports them into Supabase exactly like a live cron run.
//
// Usage:
//   DT_SESSION_COOKIE=... DT_REMEMBER_TOKEN=... \
//     node scripts/backfill-paris-export-triggers.mjs --start=2026-04-01 --end=2026-04-27
//
// Optional:
//   --skip=2026-04-02,2026-04-15   comma list of YYYY-MM-DD to skip
//   --email=foo@bar.com            override report recipient
//   --delay=3000                   ms between requests (default 3000)

const COOKIE = process.env.DT_SESSION_COOKIE;
const TOKEN = process.env.DT_REMEMBER_TOKEN;
const BASE = 'https://paris.dispatchtrack.com';

if (!COOKIE || !TOKEN) {
  console.error('Set DT_SESSION_COOKIE and DT_REMEMBER_TOKEN in env.');
  process.exit(1);
}

function arg(name, fallback) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : fallback;
}

const START = arg('start');
const END = arg('end');
const SKIP = (arg('skip', '') || '').split(',').filter(Boolean);
const EMAIL = arg('email', 'contacto@transportesmusan.com');
const DELAY = Number(arg('delay', '3000'));

if (!START || !END) {
  console.error('Usage: --start=YYYY-MM-DD --end=YYYY-MM-DD [--skip=...] [--email=...] [--delay=ms]');
  process.exit(1);
}

const COOKIE_HEADER = `_cluster_1_dt_auth_session=${COOKIE}; remember_user_token=${TOKEN}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function eachDate(start, end) {
  const out = [];
  for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function fetchCsrf() {
  const res = await fetch(`${BASE}/dispatch_guides_list`, {
    headers: { Cookie: COOKIE_HEADER },
  });
  const html = await res.text();
  if (html.includes('sign_in') || html.length < 500) {
    throw new Error('Cookies expired — login page returned');
  }
  const m = html.match(/csrf-token.*?content="([^"]+)"/);
  if (!m) throw new Error('CSRF token not found');
  return m[1];
}

async function triggerExport(date, csrf) {
  const url = `${BASE}/search?s=${date}&e=${date}&excel_export=true&items_flag=true&email=${encodeURIComponent(EMAIL)}&dft=1`;
  const res = await fetch(url, {
    headers: {
      Cookie: COOKIE_HEADER,
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    },
  });
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {}
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  const dates = eachDate(START, END).filter((d) => !SKIP.includes(d));
  console.log(`Triggering ${dates.length} export(s) → ${EMAIL}`);
  console.log(`Range: ${START} → ${END}${SKIP.length ? ` (skip: ${SKIP.join(',')})` : ''}`);
  const csrf = await fetchCsrf();
  console.log(`CSRF token acquired (len=${csrf.length})`);
  let ok = 0;
  let fail = 0;
  for (const d of dates) {
    try {
      const r = await triggerExport(d, csrf);
      const tag = r.ok ? 'OK' : 'FAIL';
      console.log(`${d}: ${r.status} ${tag} ${r.ok ? '' : r.body}`);
      r.ok ? ok++ : fail++;
    } catch (e) {
      console.log(`${d}: ERROR ${e.message}`);
      fail++;
    }
    if (d !== dates[dates.length - 1]) await sleep(DELAY);
  }
  console.log(`---\nDone. ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
