'use client';

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Input } from '@/components/ui/input';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

interface ScannerInputProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
}

/**
 * fase 5 (ronda 2 del mock, 5d) — el pie de `scan/[loadId]/page.tsx` lleva
 * "Ingresar código a mano" junto al botón primario. Este campo YA es la
 * superficie de entrada manual (el operario puede teclear en vez de dejar
 * disparar el lector), así que ese control no abre un segundo campo — le
 * devuelve el foco a este. `focus()` es la única operación expuesta a
 * propósito.
 */
export interface ScannerInputHandle {
  focus: () => void;
}

export const ScannerInput = forwardRef<ScannerInputHandle, ScannerInputProps>(function ScannerInput(
  { onScan, disabled },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useImperativeHandle(forwardedRef, () => ({
    focus: () => inputRef.current?.focus({ preventScroll: true }),
  }));

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

  // spec-54 race guard — see ScanField.tsx for the full explanation. The
  // auto-submit debounce and the Enter keydown handler both call fireScan()
  // with the same code; without this, a debounce fire whose setValue('')
  // hasn't committed yet when Enter's keydown arrives lets the still-stale
  // closure submit the same scan a second time.
  const submittedRef = useRef(false);

  const fireScan = (submitValue: string) => {
    const trimmed = submitValue.trim();
    if (!trimmed) return;
    if (submittedRef.current) return;
    submittedRef.current = true;
    autoSubmit.reset();
    try {
      onScan(trimmed);
    } finally {
      setValue('');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    }
  };

  // Auto-submit scanner bursts that arrive without a CR/Enter suffix.
  const autoSubmit = useScannerAutoSubmit(fireScan);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Re-arm unconditionally on every keystroke — see ScanField.tsx.
    submittedRef.current = false;
    setValue(e.target.value);
    autoSubmit.handleValueChange(e.target.value);
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
        placeholder="Esperando el disparo del lector…"
        disabled={disabled}
        className="min-h-[48px] text-base font-medium text-center bg-accent text-accent-foreground placeholder:text-accent-foreground/70 sm:min-h-0 sm:text-lg sm:font-mono sm:text-left sm:bg-input sm:text-foreground sm:placeholder:text-muted-foreground"
        autoComplete="off"
        aria-label="Barcode scanner input"
      />
    </div>
  );
});
