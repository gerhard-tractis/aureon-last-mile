/**
 * Generates a CSS color ramp (50-950 shades) from a single hex color.
 * Uses HSL manipulation: keeps Hue constant, varies Saturation and Lightness.
 */

function hexToHsl(hex: string): [number, number, number] {
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
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Validates a CSS hex color string */
export function isValidHexColor(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/**
 * Generates CSS variable entries for a color ramp.
 * @param prefix - CSS variable prefix (e.g., "primary" or "secondary")
 * @param baseHex - Base hex color (e.g., "#1e40af")
 * @returns Record of CSS variable name → hex value
 */
export function generateColorRamp(
  prefix: string,
  baseHex: string
): Record<string, string> {
  if (!isValidHexColor(baseHex)) return {};

  const [h, s] = hexToHsl(baseHex);

  // shade → [lightness%, saturation multiplier]
  const shades: [number, number, number][] = [
    [50, 97, 0.3],
    [100, 93, 0.5],
    [200, 85, 0.6],
    [300, 75, 0.7],
    [400, 60, 0.85],
    [500, 50, 1.0],
    [600, 42, 1.0],
    [700, 35, 0.9],
    [800, 28, 0.8],
    [900, 20, 0.7],
    [950, 12, 0.6],
  ];

  const ramp: Record<string, string> = {};
  for (const [shade, lightness, satMul] of shades) {
    const adjustedSat = Math.min(100, s * satMul);
    ramp[`--color-${prefix}-${shade}`] = hslToHex(h, adjustedSat, lightness);
  }

  return ramp;
}
