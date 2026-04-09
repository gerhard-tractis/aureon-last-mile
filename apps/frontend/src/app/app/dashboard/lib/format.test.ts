import { describe, it, expect } from 'vitest';
import { formatNumber, formatPercent, formatDelta, formatCurrency } from './format';

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------
describe('formatNumber', () => {
  it('formats positive integer with thousands separator', () => {
    // es-CL uses "." as thousands separator
    expect(formatNumber(12431)).toBe('12.431');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('returns em-dash for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('—');
  });

  it('formats large number', () => {
    expect(formatNumber(1000000)).toBe('1.000.000');
  });

  it('formats small number with no separator', () => {
    expect(formatNumber(999)).toBe('999');
  });
});

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------
describe('formatPercent', () => {
  it('formats decimal percent with comma', () => {
    // es-CL uses "," as decimal separator
    expect(formatPercent(94.2)).toBe('94,2%');
  });

  it('formats 100 without decimal', () => {
    expect(formatPercent(100)).toBe('100%');
  });

  it('formats 0', () => {
    expect(formatPercent(0)).toBe('0%');
  });

  it('returns em-dash for null', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatPercent(undefined)).toBe('—');
  });

  it('formats single decimal value', () => {
    expect(formatPercent(33.3)).toBe('33,3%');
  });
});

// ---------------------------------------------------------------------------
// formatDelta
// ---------------------------------------------------------------------------
describe('formatDelta', () => {
  it('prefixes positive delta with up triangle', () => {
    expect(formatDelta(1.4)).toBe('▲ 1,4');
  });

  it('prefixes negative delta with down triangle', () => {
    expect(formatDelta(-2.1)).toBe('▼ 2,1');
  });

  it('formats zero without triangle', () => {
    expect(formatDelta(0)).toBe('0,0');
  });

  it('returns em-dash for null', () => {
    expect(formatDelta(null)).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatDelta(undefined)).toBe('—');
  });

  it('handles positive integer delta', () => {
    expect(formatDelta(5)).toBe('▲ 5,0');
  });

  it('handles negative integer delta', () => {
    expect(formatDelta(-3)).toBe('▼ 3,0');
  });
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('formats CLP currency without decimals', () => {
    expect(formatCurrency(125000, 'CLP')).toBe('$ 125.000');
  });

  it('formats zero CLP', () => {
    expect(formatCurrency(0, 'CLP')).toBe('$ 0');
  });

  it('returns em-dash for null', () => {
    expect(formatCurrency(null, 'CLP')).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatCurrency(undefined, 'CLP')).toBe('—');
  });
});
