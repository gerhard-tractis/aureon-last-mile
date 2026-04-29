'use client';

import { useRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface ScannerInputProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
}

// Hardware scanners that aren't configured to send a CR/Enter suffix arrive
// as a fast burst of keystrokes with no terminator. We detect the burst by
// the elapsed time between the first character and the moment typing stops:
// scanners drop the full barcode in well under 200 ms, while human typing
// pauses much longer between characters.
const SCANNER_BURST_MAX_MS = 200;
const IDLE_DEBOUNCE_MS = 120;
const MIN_AUTO_SUBMIT_LENGTH = 4;

export function ScannerInput({ onScan, disabled }: ScannerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferStartRef = useRef<number | null>(null);

  // Auto-focus on mount and after each scan. preventScroll keeps the page
  // from jumping when the input regains focus — without it, marking a package
  // verified anywhere in the list re-toggles `disabled` (mutation isPending),
  // this effect re-runs, focus() scrolls the input into view, and the user
  // loses their place in the list.
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [disabled]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fireScan = (submitValue: string) => {
    const trimmed = submitValue.trim();
    if (!trimmed) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    bufferStartRef.current = null;
    onScan(trimmed);
    setValue('');
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (newValue === '') {
      bufferStartRef.current = null;
      return;
    }
    if (bufferStartRef.current === null) {
      bufferStartRef.current = Date.now();
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const start = bufferStartRef.current;
      const finalValue = inputRef.current?.value ?? newValue;
      if (
        start !== null &&
        Date.now() - start <= SCANNER_BURST_MAX_MS &&
        finalValue.trim().length >= MIN_AUTO_SUBMIT_LENGTH
      ) {
        fireScan(finalValue);
      }
    }, IDLE_DEBOUNCE_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      fireScan(value);
    }
  };

  return (
    <div className="relative">
      {/*
        Single input — styled as a large tap-target on mobile (min-h-12, accent bg),
        standard text field on desktop (sm:).
      */}
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Re-focus if not disabled (hardware scanner needs focus)
          if (!disabled) {
            setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
          }
        }}
        placeholder="Scan barcode..."
        disabled={disabled}
        className="min-h-[48px] text-base font-medium text-center bg-accent text-accent-foreground placeholder:text-accent-foreground/70 sm:min-h-0 sm:text-lg sm:font-mono sm:text-left sm:bg-input sm:text-foreground sm:placeholder:text-muted-foreground"
        autoComplete="off"
        aria-label="Barcode scanner input"
      />
    </div>
  );
}
