/**
 * Backfill delivery_attempts from DispatchTrack (Paris/Beetrack)
 *
 * Strategy: Use Playwright in headed mode to:
 * 1. Let user log in to DispatchTrack
 * 2. Scrape dispatch_guides_list page day-by-day for the last month
 * 3. Extract order_number + Estado + date for each row
 * 4. Map Estado to delivery_attempt status
 * 5. Upsert to Supabase
 */

import { chromium } from 'playwright';

const BASE_URL = 'https://paris.dispatchtrack.com';
const OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
const PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';
const ACCESS_TOKEN = 'sbp_42e24919c87af44a2626b52dbc6dfd55eff3b692';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indmd2xjcG5ra3h4emR2aHZ2c3hiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDY3NDE5MCwiZXhwIjoyMDg2MjUwMTkwfQ.FyUs3IWwbRxDVCgF9yqR-Nwv01pkdlFFJZunFQ33t5I';

// Estado → delivery_attempt status mapping (from Story 3A.1)
const ESTADO_MAP = {
  'Entregado': { status: 'success', failure_reason: null },
  'Entregado con novedad': { status: 'success', failure_reason: null },
  'No Entregado': { status: 'failed', failure_reason: 'No Entregado' },
  'Fallido': { status: 'failed', failure_reason: 'Fallido' },
  'Ausente': { status: 'failed', failure_reason: 'Ausente' },
  'Dirección incorrecta': { status: 'failed', failure_reason: 'Dirección incorrecta' },
  'Rechazado': { status: 'failed', failure_reason: 'Rechazado' },
  'Devuelto': { status: 'returned', failure_reason: 'Devuelto' },
  'Devolución': { status: 'returned', failure_reason: 'Devolución' },
};

// Non-terminal statuses to skip
const SKIP_STATUSES = new Set([
  'Ruta troncal', 'Reagendado', 'En camino', 'En reparto',
  'Asignado', 'Pendiente', 'Sin asignar', 'Programado',
]);

async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}

function formatDateDMY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatDateISO(date) {
  return date.toISOString().split('T')[0];
}

async function scrapeDay(page, date) {
  const dateParam = formatDateDMY(date);
  const url = `${BASE_URL}/dispatch_guides_list?fld=&dft=1&se[from]=${dateParam}&se[to]=${dateParam}`;

  console.log(`  Scraping ${dateParam}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Check for session expiry
  if (page.url().includes('sign_in')) {
    throw new Error('Session expired — please log in again');
  }

  // Wait for table to load
  await page.waitForTimeout(2000);

  // Try to find the data table — DispatchTrack uses various table structures
  // First, let's capture what the page looks like
  const pageData = await page.evaluate(() => {
    const results = [];

    // Strategy 1: Look for table rows with order data
    const rows = document.querySelectorAll('table tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 7) {
        // Typical DispatchTrack table: Route ID, Order #, Customer, Address, Date, Status...
        const rowData = Array.from(cells).map(c => (c.textContent || '').trim());
        results.push(rowData);
      }
    }

    // Strategy 2: If no table rows, look for card/list items
    if (results.length === 0) {
      const cards = document.querySelectorAll('[class*="dispatch"], [class*="guide"], [class*="order"]');
      for (const card of cards) {
        results.push(['CARD', card.textContent?.trim().substring(0, 200)]);
      }
    }

    // Also capture page title/header for debugging
    const header = document.querySelector('h1, h2, .page-title')?.textContent?.trim() || '';
    const totalText = document.body.innerText.match(/(\d+)\s*(resultado|registro|orden|guía)/i)?.[0] || '';

    return { rows: results, header, totalText, url: window.location.href };
  });

  return pageData;
}

async function main() {
  console.log('=== DispatchTrack Delivery Attempts Backfill ===\n');

  // Launch browser in headed mode for login
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Navigate to DispatchTrack
  console.log('Opening DispatchTrack login page...');
  console.log('Please log in manually. The script will continue once you reach the dashboard.\n');

  await page.goto(`${BASE_URL}/dispatch_guides_list`, { waitUntil: 'networkidle', timeout: 120000 });

  // Wait for user to log in — check every 2s if we're past the login page
  let attempts = 0;
  while (page.url().includes('sign_in') || page.url().includes('login')) {
    if (attempts % 5 === 0) {
      console.log('  Waiting for login... (you have 2 minutes)');
    }
    await page.waitForTimeout(2000);
    attempts++;
    if (attempts > 60) {
      console.error('Login timeout — exiting');
      await browser.close();
      process.exit(1);
    }
  }

  console.log('Logged in! Starting data scrape...\n');

  // First, let's do a single day scrape to understand the page structure
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  console.log('--- PROBE: Checking page structure ---');
  const probe = await scrapeDay(page, yesterday);
  console.log(`  URL: ${probe.url}`);
  console.log(`  Header: ${probe.header}`);
  console.log(`  Total text: ${probe.totalText}`);
  console.log(`  Table rows found: ${probe.rows.length}`);
  if (probe.rows.length > 0) {
    console.log(`  First row columns: ${probe.rows[0].length}`);
    console.log(`  First row sample:`, probe.rows[0].slice(0, 8));
  }
  if (probe.rows.length > 1) {
    console.log(`  Second row sample:`, probe.rows[1].slice(0, 8));
  }

  // Dump full page structure for debugging
  const pageHTML = await page.evaluate(() => {
    // Get table headers if they exist
    const headers = Array.from(document.querySelectorAll('table thead th, table tr:first-child th'))
      .map(h => h.textContent?.trim());

    // Get any data-attributes or classes that might help identify columns
    const tableClasses = document.querySelector('table')?.className || 'NO TABLE';

    return { headers, tableClasses };
  });
  console.log(`  Table headers:`, pageHTML.headers);
  console.log(`  Table classes:`, pageHTML.tableClasses);

  console.log('\n--- PROBE COMPLETE ---');
  console.log('Review the output above to understand the page structure.');
  console.log('Press Ctrl+C to stop, or the script will continue scraping.\n');

  // Wait a moment for user to review
  await page.waitForTimeout(5000);

  // Now scrape the full month
  const startDate = new Date('2026-02-14'); // First order date
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - 1);

  const allOrders = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    try {
      const dayData = await scrapeDay(page, currentDate);

      if (dayData.rows.length > 0) {
        for (const row of dayData.rows) {
          allOrders.push({
            date: formatDateISO(currentDate),
            raw: row
          });
        }
        console.log(`    → ${dayData.rows.length} rows found`);
      } else {
        console.log(`    → No data`);
      }
    } catch (err) {
      console.error(`    → Error: ${err.message}`);
      if (err.message.includes('Session expired')) {
        console.error('Session expired! Please log in again and restart the script.');
        break;
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
    // Small delay between requests to avoid rate limiting
    await page.waitForTimeout(1000);
  }

  console.log(`\n=== Scraping complete: ${allOrders.length} total order rows ===\n`);

  // Save raw data to file for debugging
  const fs = await import('fs');
  fs.writeFileSync('scripts/raw-scrape-data.json', JSON.stringify(allOrders, null, 2));
  console.log('Raw data saved to scripts/raw-scrape-data.json');

  await browser.close();

  // If we got data, process it
  if (allOrders.length === 0) {
    console.log('No data scraped. Check the probe output above to adjust selectors.');
    process.exit(1);
  }

  // TODO: After probe run, we'll know the column mapping and can process + upsert
  console.log('\nDone. Review raw-scrape-data.json and the probe output to refine column mapping.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
