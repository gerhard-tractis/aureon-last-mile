#!/usr/bin/env node
// Drives the DispatchTrack UI's "Exportar a excel" flow with the date picker
// pre-set, one day at a time. The /search?excel_export=true HTTP endpoint
// caps results to ~7-10 days; the UI flow may use a different backend path
// that respects historical ranges. Each successful run causes DispatchTrack
// to email an XLSX which n8n's IMAP trigger then imports.

import { chromium } from 'playwright';

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
const HEADLESS = arg('headless', 'true') !== 'false';

if (!START || !END) {
  console.error('Usage: --start=YYYY-MM-DD --end=YYYY-MM-DD [--skip=...] [--email=...] [--headless=false]');
  process.exit(1);
}

function eachDate(start, end) {
  const out = [];
  for (let d = new Date(start); d <= new Date(end); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

function fmt(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return { dd_mm_yyyy: `${dd}-${mm}-${yyyy}`, yyyy_mm_dd: `${yyyy}-${mm}-${dd}` };
}

async function exportOne(page, date) {
  const { dd_mm_yyyy, yyyy_mm_dd } = fmt(date);
  const url = `${BASE}/dispatch_guides_list?fld=&dft=1&se[from]=${dd_mm_yyyy}&se[to]=${dd_mm_yyyy}`;

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  if (page.url().includes('sign_in')) {
    throw new Error('cookies expired — login page detected');
  }

  if (process.env.DEBUG_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/dt-${yyyy_mm_dd}-loaded.png`, fullPage: true });
    const buttons = await page.evaluate(`
      Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 20)
    `);
    console.log(`  [debug] page title="${await page.title()}" buttons=${JSON.stringify(buttons)}`);
  }

  await page.locator('button').filter({ hasText: 'Exportar a excel' }).click({ force: true });
  await page.waitForTimeout(800);

  const emailInput = page.locator('.hp-modal__surface input[type="email"]').first();
  await emailInput.fill(EMAIL);

  const checkbox = page.locator('.hp-modal__surface input[type="checkbox"]').first();
  if (!(await checkbox.isChecked())) {
    await checkbox.click({ force: true });
    await page.waitForTimeout(200);
  }

  await page.locator('.hp-modal__surface button').filter({ hasText: 'Generar reporte' }).click();
  await page.waitForTimeout(1500);

  const toasts = await page.evaluate(`
    (() => {
      const ts = document.querySelectorAll("[class*='toast'], [role='alert']");
      return Array.from(ts).map(t => (t.textContent || '').trim()).filter(Boolean);
    })()
  `);
  const ok = toasts.some((t) => t.includes('correo electrónico') || t.includes('correo electronico'));

  // Close modal if it stayed open (keeps subsequent navigations clean)
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } catch {}

  return { date: yyyy_mm_dd, ok, toasts };
}

async function main() {
  const dates = eachDate(START, END).filter((d) => !SKIP.includes(fmt(d).yyyy_mm_dd));
  console.log(`Will export ${dates.length} day(s) (${fmt(dates[0]).yyyy_mm_dd} → ${fmt(dates[dates.length - 1]).yyyy_mm_dd}) → ${EMAIL}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const domain = new URL(BASE).hostname.replace(/^[^.]+/, '');
  await context.addCookies([
    { name: '_cluster_1_dt_auth_session', value: COOKIE, domain, path: '/' },
    { name: 'remember_user_token', value: TOKEN, domain, path: '/' },
  ]);
  const page = await context.newPage();

  let ok = 0;
  let fail = 0;
  for (const d of dates) {
    try {
      const r = await exportOne(page, d);
      console.log(`${r.date}: ${r.ok ? 'OK' : 'FAIL'}  toasts=${JSON.stringify(r.toasts)}`);
      r.ok ? ok++ : fail++;
    } catch (e) {
      console.log(`${fmt(d).yyyy_mm_dd}: ERROR ${e.message}`);
      fail++;
    }
    await page.waitForTimeout(2500);
  }

  await browser.close();
  console.log(`---\nDone. ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
