import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * spec-63 — the status chips carry a glyph, and that glyph is the second of
 * the two channels spec-54 encodes every state with (colour AND shape). The
 * shipped solid tokens put white at 2.54:1 (success) and 2.15:1 (warning) in
 * light theme, and failed on all four in dark — below the 3:1 WCAG 1.4.11
 * requires for non-text content.
 *
 * The sibling component tests assert CLASS NAMES, which cannot catch a
 * retuned colour: swap `--color-status-warning-chip` back to #f59e0b and every
 * one of them still passes. This test reads the real values out of the
 * stylesheet, so the guarantee is on the contrast itself.
 *
 * It also pins the SHAPE channel: the chip must stay distinguishable from the
 * box it sits in, which is what ruled out simply darkening the glyph's
 * background in dark theme.
 */

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const STATUSES = ['success', 'warning', 'error', 'info'] as const;
const MIN_RATIO = 3;

/** Ranges of the file that sit inside an `html.dark { … }` block. */
function darkRanges(css: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /html\.dark\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

const DARK = darkRanges(CSS);
const isDark = (i: number) => DARK.some(([a, b]) => i >= a && i < b);

function token(name: string, theme: 'light' | 'dark'): string {
  const re = new RegExp(`--${name}\s*:\s*([^;]+);`, 'g');
  let m: RegExpExecArray | null;
  let found: string | null = null;
  while ((m = re.exec(CSS))) {
    const dark = isDark(m.index);
    if ((theme === 'dark') === dark) found = m[1].trim();
  }
  if (!found) throw new Error(`token --${name} not found for ${theme} theme`);
  return found;
}

function toRgb(v: string): [number, number, number] {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = v.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const p = rgba[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2]];
  }
  throw new Error(`cannot parse colour: ${v}`);
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function flatten(v: string, backdrop: [number, number, number]): [number, number, number] {
  const rgba = v.match(/rgba\(([^)]+)\)/i);
  const [r, g, b] = toRgb(v);
  if (!rgba) return [r, g, b];
  const a = parseFloat(rgba[1].split(',')[3] ?? '1');
  return [
    a * r + (1 - a) * backdrop[0],
    a * g + (1 - a) * backdrop[1],
    a * b + (1 - a) * backdrop[2],
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('spec-63 status chip contrast', () => {
  describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
    const surface = toRgb(token(`color-surface`, theme));

    it.each(STATUSES)('%s glyph clears 3:1 against its chip', (status) => {
      const chip = toRgb(token(`color-status-${status}-chip`, theme));
      const fg = toRgb(token(`color-status-${status}-chip-fg`, theme));
      expect(contrast(fg, chip)).toBeGreaterThanOrEqual(MIN_RATIO);
    });

    it.each(STATUSES)('%s chip stays visible against its own box', (status) => {
      // The shape channel. A chip that dissolves into its container leaves
      // the state carried by colour alone — the failure spec-54 exists to
      // prevent, and the reason the fix is not simply "darken everything".
      const chip = toRgb(token(`color-status-${status}-chip`, theme));
      const box = flatten(token(`color-status-${status}-bg`, theme), surface);
      expect(contrast(chip, box)).toBeGreaterThanOrEqual(MIN_RATIO);
    });
  });
});
