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
 * The input color is anchored at shade-600 (the primary UI shade used for
 * buttons, links, text-primary-600, etc.) and the rest of the ramp is built
 * proportionally around it. This ensures very dark or very light brand colors
 * still produce a usable ramp where the most-used shade matches the brand.
 *
 * @param prefix - CSS variable prefix (e.g., "primary" or "secondary")
 * @param baseHex - Base hex color (e.g., "#1e40af")
 * @returns Record of CSS variable name → hex value
 */
export function generateColorRamp(
  prefix: string,
  baseHex: string
): Record<string, string> {
  if (!isValidHexColor(baseHex)) return {};

  const [h, s, baseL] = hexToHsl(baseHex);

  const lightEnd = 97;
  const darkEnd = 12;

  // Anchor input color at shade 600, scale lighter/darker proportionally
  const lightnessMap: Record<number, number> = {
    50:  lightEnd,
    100: baseL + (lightEnd - baseL) * 0.85,
    200: baseL + (lightEnd - baseL) * 0.70,
    300: baseL + (lightEnd - baseL) * 0.55,
    400: baseL + (lightEnd - baseL) * 0.35,
    500: baseL + (lightEnd - baseL) * 0.15,
    600: baseL,
    700: baseL - (baseL - darkEnd) * 0.25,
    800: baseL - (baseL - darkEnd) * 0.50,
    900: baseL - (baseL - darkEnd) * 0.75,
    950: darkEnd,
  };

  const satMultipliers: Record<number, number> = {
    50: 0.3, 100: 0.5, 200: 0.6, 300: 0.7, 400: 0.85,
    500: 1.0, 600: 1.0, 700: 0.9, 800: 0.8, 900: 0.7, 950: 0.6,
  };

  const ramp: Record<string, string> = {};
  for (const shade of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    const adjustedSat = Math.min(100, s * satMultipliers[shade]);
    ramp[`--color-${prefix}-${shade}`] = hslToHex(h, adjustedSat, lightnessMap[shade]);
  }

  return ramp;
}
