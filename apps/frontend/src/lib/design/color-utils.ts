/**
 * Design system color utilities.
 * Builds on the existing generateColorRamp utility for ramp generation.
 */

import {
  isValidHexColor,
  generateColorRamp as _generateColorRamp,
} from '@/lib/utils/generateColorRamp';

export { isValidHexColor };

/** Generates a primary-50 → primary-950 color ramp from a single hex color. */
export function generateColorRamp(hex: string): Record<string, string> {
  return _generateColorRamp('primary', hex);
}

export interface BrandPalette {
  brand_primary: string;
  brand_background: string;
  brand_text: string;
  brand_secondary?: string;
}

export type CSSTokenMap = Record<string, string>;

/**
 * Returns '#ffffff' or '#0f172a' depending on which gives >= 4.5:1 contrast
 * against bgHex (WCAG AA). Uses relative luminance via the sRGB formula.
 */
export function getContrastForeground(bgHex: string): '#ffffff' | '#0f172a' {
  if (!isValidHexColor(bgHex)) return '#0f172a';

  // Parse hex to linear RGB
  const hex = bgHex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  // Linearize sRGB values
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const luminance =
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

  // Pick whichever text color gives higher contrast (WCAG relative luminance).
  // darkTextLuminance for #0f172a
  const darkTextLuminance = 0.0090; // pre-computed for #0f172a
  const contrastWithWhite = (1.0 + 0.05) / (luminance + 0.05);
  const contrastWithDark  = (luminance + 0.05) / (darkTextLuminance + 0.05);

  return contrastWithWhite >= contrastWithDark ? '#ffffff' : '#0f172a';
}

/** Converts a hex color to [hue, saturation, lightness] tuple. */
export function hexToHsl(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 50];
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

/** Mixes two hex colors. ratio 0 = fully a, ratio 1 = fully b */
function mixHex(hexA: string, hexB: string, ratio: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(hexA);
  const [br, bg, bb] = parse(hexB);
  const r = Math.round(ar + (br - ar) * ratio);
  const g = Math.round(ag + (bg - ag) * ratio);
  const b = Math.round(ab + (bb - ab) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Derives all CSS tokens for the `custom` mode from a 4-field brand palette.
 * Returns empty object if any required field is an invalid hex color.
 */
export function generateBrandTokens(palette: BrandPalette): CSSTokenMap {
  const { brand_primary, brand_background, brand_text, brand_secondary } = palette;

  // Validate required fields
  if (
    !isValidHexColor(brand_primary) ||
    !isValidHexColor(brand_background) ||
    !isValidHexColor(brand_text)
  ) {
    return {};
  }

  const tokens: CSSTokenMap = {};

  // Accent tokens
  tokens['--color-accent'] = brand_primary;
  // Lighter version: mix primary with white 30%
  tokens['--color-accent-light'] = mixHex(brand_primary, '#ffffff', 0.3);
  // Muted: mix primary with background 90% (10% primary tint)
  tokens['--color-accent-muted'] = mixHex(brand_background, brand_primary, 0.1);
  tokens['--color-accent-foreground'] = getContrastForeground(brand_primary);

  // Optional secondary accent
  if (brand_secondary && isValidHexColor(brand_secondary)) {
    tokens['--color-accent-secondary'] = brand_secondary;
  }

  // Surface tokens — derived from brand_background
  tokens['--color-background'] = brand_background;
  // Surface: slightly whiter/lighter than background
  tokens['--color-surface'] = mixHex(brand_background, '#ffffff', 0.5);
  // Surface raised: tiny primary tint
  tokens['--color-surface-raised'] = mixHex(brand_background, brand_primary, 0.06);
  // Borders: darken background
  tokens['--color-border'] = mixHex(brand_background, '#000000', 0.12);
  tokens['--color-border-subtle'] = mixHex(brand_background, '#000000', 0.06);

  // Text tokens — derived from brand_text
  tokens['--color-text'] = brand_text;
  // Secondary: mix text with background 40%
  tokens['--color-text-secondary'] = mixHex(brand_text, brand_background, 0.4);
  // Muted: mix text with background 65%
  tokens['--color-text-muted'] = mixHex(brand_text, brand_background, 0.65);

  // Full primary-50 to primary-900 ramp (spec requirement)
  const ramp = generateColorRamp(brand_primary);
  Object.assign(tokens, ramp);

  return tokens;
}
