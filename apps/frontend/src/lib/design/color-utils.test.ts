import { describe, it, expect } from 'vitest';
import {
  getContrastForeground,
  generateBrandTokens,
} from './color-utils';

describe('getContrastForeground', () => {
  it('returns white text on dark backgrounds', () => {
    expect(getContrastForeground('#c8102e')).toBe('#ffffff'); // Falabella red
    expect(getContrastForeground('#1a1a1a')).toBe('#ffffff'); // near-black
    expect(getContrastForeground('#ca9a04')).toBe('#ffffff'); // dark gold
  });

  it('returns dark text on light backgrounds', () => {
    expect(getContrastForeground('#ffffff')).toBe('#0f172a'); // white
    expect(getContrastForeground('#f8fafc')).toBe('#0f172a'); // slate-50
    expect(getContrastForeground('#fef9c3')).toBe('#0f172a'); // light yellow
    expect(getContrastForeground('#e6c15c')).toBe('#0f172a'); // light gold
  });
});

describe('generateBrandTokens', () => {
  const palette = {
    brand_primary: '#c8102e',
    brand_background: '#ffffff',
    brand_text: '#1a1a1a',
  };

  it('returns an empty object for invalid palette', () => {
    expect(generateBrandTokens({ brand_primary: 'not-a-color', brand_background: '#fff', brand_text: '#000' })).toEqual({});
    expect(generateBrandTokens({ brand_primary: '#c8102e', brand_background: 'bad', brand_text: '#000' })).toEqual({});
  });

  it('sets --color-accent to brand_primary', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-accent']).toBe('#c8102e');
  });

  it('sets --color-background to brand_background', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-background']).toBe('#ffffff');
  });

  it('sets --color-text to brand_text', () => {
    const tokens = generateBrandTokens(palette);
    expect(tokens['--color-text']).toBe('#1a1a1a');
  });

  it('sets --color-accent-foreground based on contrast', () => {
    const tokens = generateBrandTokens(palette);
    // red background → white foreground
    expect(tokens['--color-accent-foreground']).toBe('#ffffff');
  });

  it('produces a full token map with all required keys', () => {
    const tokens = generateBrandTokens(palette);
    const required = [
      '--color-background',
      '--color-surface',
      '--color-surface-raised',
      '--color-border',
      '--color-border-subtle',
      '--color-accent',
      '--color-accent-light',
      '--color-accent-muted',
      '--color-accent-foreground',
      '--color-text',
      '--color-text-secondary',
      '--color-text-muted',
    ];
    for (const key of required) {
      expect(tokens).toHaveProperty(key);
      expect(tokens[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('uses brand_secondary as secondary accent when provided', () => {
    const tokensWithSecondary = generateBrandTokens({
      ...palette,
      brand_secondary: '#0057a8',
    });
    expect(tokensWithSecondary['--color-accent-secondary']).toBe('#0057a8');
  });

  it('includes a primary-50 to primary-900 color ramp', () => {
    const tokens = generateBrandTokens(palette);
    for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(tokens).toHaveProperty(`--color-primary-${shade}`);
      expect(tokens[`--color-primary-${shade}`]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
