import { describe, it, expect } from 'vitest';
import { normalizeScanCode, scanCodesMatch } from './normalize-scan-code';

/**
 * project_qa_scanner_hardware: the QA hardware scanner has no CR/Enter
 * suffix (handled by useScannerAutoSubmit) and a US/ES keyboard-layout
 * mismatch that corrupts hyphens — a real scan arrived as `CARGA'PARIS'...`,
 * apostrophes where hyphens belong. A stored code like "POS-04" must still
 * match a scan of "POS'04" (corrupted) or "POS04" (hyphen dropped
 * entirely). normalizeScanCode collapses all three forms to the same key.
 */
describe('normalizeScanCode', () => {
  it('uppercases', () => {
    expect(normalizeScanCode('pos-04')).toBe('POS04');
  });

  it('strips hyphens', () => {
    expect(normalizeScanCode('POS-04')).toBe('POS04');
  });

  it('strips the apostrophe the US/ES layout mismatch substitutes for a hyphen', () => {
    expect(normalizeScanCode("POS'04")).toBe('POS04');
  });

  it('leaves an already-unhyphenated scan unchanged (modulo case)', () => {
    expect(normalizeScanCode('pos04')).toBe('POS04');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeScanCode('  POS-04  ')).toBe('POS04');
  });

  it('strips other punctuation a corrupted layout might substitute', () => {
    expect(normalizeScanCode('POS_04')).toBe('POS04');
    expect(normalizeScanCode('POS.04')).toBe('POS04');
  });
});

describe('scanCodesMatch', () => {
  it('matches a hyphenated stored code against a corrupted scan', () => {
    expect(scanCodesMatch("POS'04", 'POS-04')).toBe(true);
  });

  it('matches a hyphenated stored code against an unhyphenated scan', () => {
    expect(scanCodesMatch('POS04', 'POS-04')).toBe(true);
  });

  it('matches a hyphenated stored code against an identical scan', () => {
    expect(scanCodesMatch('POS-04', 'POS-04')).toBe(true);
  });

  it('does not match a different code', () => {
    expect(scanCodesMatch('POS-05', 'POS-04')).toBe(false);
  });

  it('never matches when the scan normalizes to empty (all-punctuation garbage)', () => {
    expect(scanCodesMatch('---', 'POS-04')).toBe(false);
    // Guards the degenerate case that motivates the check: two
    // all-punctuation strings must not compare equal just because they
    // both normalize to ''.
    expect(scanCodesMatch('---', '...')).toBe(false);
    expect(normalizeScanCode('---')).toBe('');
  });
});
