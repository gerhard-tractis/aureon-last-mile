#!/usr/bin/env node
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

const svgBuffer = readFileSync(join(publicDir, 'icon.svg'));

console.log('Generating PWA icons...');

// 192x192 icon
await sharp(svgBuffer)
  .resize(192, 192)
  .png()
  .toFile(join(publicDir, 'icon-192.png'));
console.log('✓ icon-192.png created');

// 512x512 icon
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile(join(publicDir, 'icon-512.png'));
console.log('✓ icon-512.png created');

// 180x180 Apple Touch Icon
await sharp(svgBuffer)
  .resize(180, 180)
  .png()
  .toFile(join(publicDir, 'apple-touch-icon.png'));
console.log('✓ apple-touch-icon.png created');

console.log('All icons generated successfully!');
