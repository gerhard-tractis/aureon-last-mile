import { describe, it, expect } from 'vitest';
import { generateColorRamp, isValidHexColor } from './generateColorRamp';

describe('isValidHexColor', () => {
  it('accepts valid 6-digit hex colors', () => {
    expect(isValidHexColor('#1e40af')).toBe(true);
    expect(isValidHexColor('#FF0000')).toBe(true);
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#ffffff')).toBe(true);
  });

  it('rejects invalid colors', () => {
    expect(isValidHexColor('1e40af')).toBe(false);    // no #
    expect(isValidHexColor('#fff')).toBe(false);       // 3-digit
    expect(isValidHexColor('#gggggg')).toBe(false);    // invalid chars
    expect(isValidHexColor('')).toBe(false);
    expect(isValidHexColor('red')).toBe(false);
  });
});

describe('generateColorRamp', () => {
  it('returns empty object for invalid hex', () => {
    expect(generateColorRamp('primary', 'invalid')).toEqual({});
    expect(generateColorRamp('primary', '#fff')).toEqual({});
  });

  it('generates all 11 shades (50-950) for a valid hex', () => {
    const ramp = generateColorRamp('primary', '#1e40af');
    const expectedShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

    for (const shade of expectedShades) {
      const key = `--color-primary-${shade}`;
      expect(ramp).toHaveProperty(key);
      expect(ramp[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(Object.keys(ramp)).toHaveLength(11);
  });

  it('uses provided prefix for CSS variable names', () => {
    const ramp = generateColorRamp('secondary', '#475569');
    expect(ramp).toHaveProperty('--color-secondary-500');
    expect(ramp).not.toHaveProperty('--color-primary-500');
  });

  it('generates lighter shades for low numbers and darker for high', () => {
    const ramp = generateColorRamp('primary', '#3b82f6');
    // shade-50 should be very light (high lightness ≈ #f*), shade-950 very dark
    const shade50 = ramp['--color-primary-50'];
    const shade950 = ramp['--color-primary-950'];

    // Convert first hex digit to number — 50 should start with f (light), 950 with low digit (dark)
    const light = parseInt(shade50.slice(1, 3), 16);
    const dark = parseInt(shade950.slice(1, 3), 16);
    expect(light).toBeGreaterThan(dark);
  });

  it('handles pure red', () => {
    const ramp = generateColorRamp('primary', '#ff0000');
    expect(Object.keys(ramp)).toHaveLength(11);
    // All shades should be valid hex
    for (const val of Object.values(ramp)) {
      expect(val).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('handles pure black (edge case — zero saturation)', () => {
    const ramp = generateColorRamp('primary', '#000000');
    expect(Object.keys(ramp)).toHaveLength(11);
  });

  it('handles pure white (edge case)', () => {
    const ramp = generateColorRamp('primary', '#ffffff');
    expect(Object.keys(ramp)).toHaveLength(11);
  });
});
