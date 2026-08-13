import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Spec-54 phase 1 — the token contract.
 *
 * The rebrand's core rule is "no hex literal in a component; if you need one,
 * a token is missing". That only holds if every mode declares every token —
 * a token that exists in `html.light` but not `html.dark` is worse than no
 * token at all, because it fails silently as an unresolved var().
 *
 * This test parses globals.css and enforces that. It is the net that catches
 * the next token added to one mode and forgotten in the other two.
 */

// vitest runs with apps/frontend as root (see vitest.config.ts).
const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
const TAILWIND = readFileSync(resolve(process.cwd(), 'tailwind.config.ts'), 'utf8');

type Block = { selectors: string[]; declarations: Map<string, string> };

function parseBlocks(css: string): Block[] {
  // Strip comments first so a commented-out token never counts as declared.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Block[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(stripped)) !== null) {
    const selectors = match[1]
      .split(',')
      // A selector list is preceded by whatever statement closed last
      // (`@tailwind utilities;`, a prior `}`), so keep only the tail.
      .map((s) => s.split(';').pop()!.split('}').pop()!.trim())
      .filter(Boolean);
    const declarations = new Map<string, string>();

    for (const decl of match[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (prop.startsWith('--')) declarations.set(prop, value);
    }

    blocks.push({ selectors, declarations });
  }

  return blocks;
}

const BLOCKS = parseBlocks(CSS);

/** Every custom property visible on <html> in a given mode. */
function tokensForMode(mode: 'light' | 'dark' | 'custom'): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const block of BLOCKS) {
    const applies = block.selectors.some((s) => s === ':root' || s === `html.${mode}`);
    if (!applies) continue;
    // Later blocks win, matching the cascade.
    for (const [prop, value] of block.declarations) resolved.set(prop, value);
  }
  return resolved;
}

const MODES = ['light', 'dark', 'custom'] as const;

const SURFACE_TOKENS = [
  '--color-background',
  '--color-surface',
  '--color-surface-raised',
  '--color-border',
  '--color-border-subtle',
  '--color-border-strong',
];

const TEXT_TOKENS = [
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-text-body',
];

const ACCENT_TOKENS = [
  '--color-accent',
  '--color-accent-light',
  '--color-accent-muted',
  '--color-accent-foreground',
  '--color-accent-light-foreground',
];

const SIDEBAR_TOKENS = [
  '--color-sidebar-bg',
  '--color-sidebar-text',
  '--color-sidebar-text-active',
  '--color-sidebar-hover',
  '--color-sidebar-section',
  '--color-sidebar-border',
  '--color-sidebar-raised',
];

const STATUS_TOKENS = (['success', 'warning', 'error'] as const).flatMap((s) => [
  `--color-status-${s}`,
  `--color-status-${s}-bg`,
  `--color-status-${s}-border`,
  `--color-status-${s}-text`,
]);

const MAP_TOKENS = ['--color-map-surface', '--color-map-line'];

const REQUIRED = [
  ...SURFACE_TOKENS,
  ...TEXT_TOKENS,
  ...ACCENT_TOKENS,
  ...SIDEBAR_TOKENS,
  ...STATUS_TOKENS,
  ...MAP_TOKENS,
];

describe('design tokens — every mode declares every token', () => {
  for (const mode of MODES) {
    describe(`html.${mode}`, () => {
      const tokens = tokensForMode(mode);

      it.each(REQUIRED)('declares %s', (token) => {
        expect(tokens.has(token)).toBe(true);
      });

      it('leaves no token with an empty value', () => {
        const empty = REQUIRED.filter((t) => !tokens.get(t));
        expect(empty).toEqual([]);
      });

      it('resolves every var() reference to a token the mode also declares', () => {
        const unresolved: string[] = [];
        for (const token of REQUIRED) {
          const value = tokens.get(token) ?? '';
          for (const ref of value.matchAll(/var\((--[\w-]+)/g)) {
            if (!tokens.has(ref[1])) unresolved.push(`${token} -> ${ref[1]}`);
          }
        }
        expect(unresolved).toEqual([]);
      });
    });
  }
});

describe('design tokens — values match the Aureon Rebrand prototype', () => {
  const light = tokensForMode('light');
  const dark = tokensForMode('dark');
  const custom = tokensForMode('custom');

  it('uses the warm brown dark palette, not neutral grey', () => {
    expect(dark.get('--color-background')).toBe('#13110d');
    expect(dark.get('--color-surface')).toBe('#1e1a14');
    expect(dark.get('--color-surface-raised')).toBe('#2a2218');
    expect(dark.get('--color-text')).toBe('#f5ecd7');
  });

  it('uses gold as the brand accent in both modes', () => {
    expect(light.get('--color-accent')).toBe('#ca9a04');
    expect(dark.get('--color-accent')).toBe('#e6c15c');
    // The primary button fill is the same gold in both modes.
    expect(light.get('--color-accent-light')).toBe('#e6c15c');
    expect(dark.get('--color-accent-light')).toBe('#e6c15c');
  });

  it('pairs the light-gold button fill with dark text, not white', () => {
    // Prototype: --accent-btn / --accent-btn-text. White on #e6c15c fails
    // contrast, so the primary button gets its own foreground token rather
    // than reusing --color-accent-foreground (which sits on the darker
    // --color-accent and is consumed by ~54 existing call sites).
    expect(light.get('--color-accent-light-foreground')).toBe('#2b2620');
    expect(dark.get('--color-accent-light-foreground')).toBe('#13110d');
    expect(light.get('--color-accent-foreground')).toBe('#ffffff');
  });

  it('gives each status a readable text colour distinct from its fill', () => {
    for (const status of ['success', 'warning', 'error'] as const) {
      expect(light.get(`--color-status-${status}-text`)).not.toBe(
        light.get(`--color-status-${status}`),
      );
      // Dark tints are translucent, so the base hue doubles as the text colour.
      expect(dark.get(`--color-status-${status}-text`)).toBeTruthy();
    }
  });

  it('starts html.custom from the light palette so branding can override at runtime', () => {
    for (const token of [...SURFACE_TOKENS, ...TEXT_TOKENS, ...ACCENT_TOKENS]) {
      expect(custom.get(token)).toBe(light.get(token));
    }
  });
});

describe('typography', () => {
  it('applies tabular numerals to the mono family', () => {
    // The rebrand's rule: any number that gets compared is mono + tabular, so a
    // column of times or counts reads in one sweep.
    expect(CSS).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('keeps the landing display font separate from the app heading font', () => {
    // --font-display is Fraunces (landing). --font-heading is Archivo (app).
    expect(TAILWIND).toMatch(/display:\s*\["var\(--font-display\)"/);
    expect(TAILWIND).toMatch(/heading:\s*\["var\(--font-heading\)"/);
  });
});

describe('tailwind exposes the new tokens as utilities', () => {
  it.each([
    ['border-strong', '--color-border-strong'],
    ['body', '--color-text-body'],
    ['surface', '--color-map-surface'],
    ['line', '--color-map-line'],
    ['raised', '--color-sidebar-raised'],
    ['success-text', '--color-status-success-text'],
    ['warning-text', '--color-status-warning-text'],
    ['error-text', '--color-status-error-text'],
  ])('maps %s to %s', (_key, token) => {
    expect(TAILWIND).toContain(`var(${token})`);
  });
});
