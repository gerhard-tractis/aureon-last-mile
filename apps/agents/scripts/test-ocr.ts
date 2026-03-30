#!/usr/bin/env ts-node
/**
 * Test script — calls extractManifest directly and prints the extracted JSON.
 *
 * Usage (from apps/agents/):
 *   npx ts-node scripts/test-ocr.ts path/to/photo.jpg [path/to/page2.jpg ...]
 *
 * Reads OPENROUTER_API_KEY from apps/agents/.env automatically.
 */
import * as fs from 'fs';
import * as path from 'path';

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

import { extractManifest } from '../src/tools/ocr/extract-manifest';

async function main() {
  const photoPaths = process.argv.slice(2);

  if (photoPaths.length === 0) {
    console.error('Usage: npx ts-node scripts/test-ocr.ts photo1.jpg [photo2.jpg ...]');
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set. Add it to apps/agents/.env');
    process.exit(1);
  }

  const buffers = photoPaths.map((p) => {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    console.log(`Loading: ${resolved}`);
    return fs.readFileSync(resolved);
  });

  console.log(`\nSending ${buffers.length} page(s) to Gemini 2.5 Flash...\n`);

  const result = await extractManifest(apiKey, buffers);

  console.log('--- RAW JSON ---\n');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n--- SUMMARY ---');
  console.log(`Orders found:   ${result.orders.length}`);
  console.log(`Delivery date:  ${result.delivery_date ?? 'not found'}`);
  if (result.error) console.log(`Warning:        ${result.error}`);

  result.orders.forEach((o, i) => {
    console.log(`\nOrder ${i + 1}: ${o.order_number}`);
    console.log(`  Customer: ${o.customer_name ?? '—'}`);
    console.log(`  Address:  ${o.delivery_address ?? '—'}, ${o.comuna ?? '—'}`);
    console.log(`  Phone:    ${o.customer_phone ?? '—'}`);
    console.log(`  Packages: ${o.packages.length}`);
    o.packages.forEach((pkg, j) => {
      console.log(`    Pkg ${j + 1}: ${pkg.label} — ${pkg.declared_box_count} box(es)`);
    });
  });
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
