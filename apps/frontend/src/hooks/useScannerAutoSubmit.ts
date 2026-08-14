'use client';

import { useEffect, useRef } from 'react';

// Hardware scanners that aren't configured to send a CR/Enter suffix arrive
// as a fast burst of keystrokes with no terminator. We detect the burst by
// the gap BETWEEN consecutive characters, not the total duration: scanners
// emit ~15–50 ms per character regardless of barcode length, while human
// typing pauses well over 100 ms between keys. (Total-duration detection
// broke on real scanners: a 10+ char CTN takes >200 ms end to end even
// though every inter-key gap is tiny.)
const SCANNER_MAX_KEY_GAP_MS = 100;
const IDLE_DEBOUNCE_MS = 120;
const MIN_AUTO_SUBMIT_LENGTH = 4;

export interface ScannerAutoSubmit {
  /** Call from the input's onChange with the new value. */
  handleValueChange: (newValue: string) => void;
  /** Cancel any pending auto-submit and forget gap history — call after a
   *  manual submit (Enter) so the debounce can't double-fire. */
  reset: () => void;
}

/**
 * Shared auto-submit engine for barcode scanner inputs (pickup, reception,
 * distribution). Owns the burst-detection timing; the component keeps its own
 * controlled value and submit semantics. `onSubmit` receives the full value
 * once typing has been idle for IDLE_DEBOUNCE_MS, every inter-key gap was
 * scanner-fast, and the value is long enough to be a real barcode.
 */
export function useScannerAutoSubmit(
  onSubmit: (value: string) => void
): ScannerAutoSubmit {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCharAtRef = useRef<number | null>(null);
  const maxKeyGapRef = useRef(0);
  const valueRef = useRef('');
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const reset = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    lastCharAtRef.current = null;
    maxKeyGapRef.current = 0;
    valueRef.current = '';
  };

  const handleValueChange = (newValue: string) => {
    valueRef.current = newValue;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (newValue === '') {
      lastCharAtRef.current = null;
      maxKeyGapRef.current = 0;
      return;
    }
    const now = Date.now();
    if (lastCharAtRef.current === null) {
      maxKeyGapRef.current = 0;
    } else {
      maxKeyGapRef.current = Math.max(maxKeyGapRef.current, now - lastCharAtRef.current);
    }
    lastCharAtRef.current = now;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const finalValue = valueRef.current;
      if (
        maxKeyGapRef.current <= SCANNER_MAX_KEY_GAP_MS &&
        finalValue.trim().length >= MIN_AUTO_SUBMIT_LENGTH
      ) {
        onSubmitRef.current(finalValue);
      }
    }, IDLE_DEBOUNCE_MS);
  };

  return { handleValueChange, reset };
}
