'use client';

import { useRef, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface ScannerInputProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
}

export function ScannerInput({ onScan, disabled }: ScannerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onScan(value.trim());
      setValue('');
      // Re-focus after scan
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
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
        onChange={(e) => setValue(e.target.value)}
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
