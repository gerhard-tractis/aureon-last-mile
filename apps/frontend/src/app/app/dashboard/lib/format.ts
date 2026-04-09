/**
 * es-CL number formatting utilities for the dashboard.
 * Pure functions — no I/O, no side effects.
 * All null/undefined inputs return '—'.
 */

const EM_DASH = '—';

const integerFormatter = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const oneDecimalFormatter = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Format an integer count with es-CL thousands separator (`.`).
 * e.g. 12431 → '12.431'
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return EM_DASH;
  return integerFormatter.format(value);
}

/**
 * Format a percentage value (0–100) in es-CL locale.
 * Trailing `.0` is stripped — e.g. 94.2 → '94,2%', 100 → '100%'.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return EM_DASH;
  // Format with up to 1 decimal, then strip trailing ',0' or '.0' patterns
  const formatted = oneDecimalFormatter.format(value);
  // Remove trailing decimal zero: '94,0' → '94', '94,2' stays
  const stripped = formatted.replace(/[,.]0$/, '');
  return `${stripped}%`;
}

/**
 * Format a delta value with directional triangle prefix.
 * Positive → '▲ 1,4', Negative → '▼ 2,1', Zero → '0,0'.
 * Always shows 1 decimal place.
 */
export function formatDelta(value: number | null | undefined): string {
  if (value == null) return EM_DASH;
  const abs = Math.abs(value);
  const formatted = oneDecimalFormatter.format(abs);
  if (value > 0) return `▲ ${formatted}`;
  if (value < 0) return `▼ ${formatted}`;
  return oneDecimalFormatter.format(0);
}

/**
 * Format a monetary value in the given currency using es-CL locale.
 * CLP has no decimals. Outputs '$ 125.000' (with space after symbol).
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: string,
): string {
  if (value == null) return EM_DASH;

  const formatter = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Intl may produce '$125.000' — normalise symbol to '$ ' prefix with space
  const raw = formatter.format(value);
  // Extract the currency symbol from a zero-value format to find it
  const parts = formatter.formatToParts(value);
  const symbolPart = parts.find((p) => p.type === 'currency');
  if (!symbolPart) return raw;

  const symbol = symbolPart.value;
  // Rebuild: symbol + space + integer portion
  const numberPart = parts
    .filter((p) => p.type !== 'currency' && p.type !== 'literal')
    .map((p) => p.value)
    .join('');

  return `${symbol} ${numberPart}`;
}
