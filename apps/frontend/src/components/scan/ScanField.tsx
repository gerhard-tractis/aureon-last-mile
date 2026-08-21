'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

/**
 * spec-54 phase 3 — the scan field (mocks 1d, 1e, 1h, 1k).
 *
 * Shared because four modules scan: quicksort, reception, pickup and return
 * reception. All four have the same contract — the field is always focused, it
 * clears itself after every read, and there is no submit button, because the
 * operator's hands are on packages and a scanner gun, not on the screen.
 *
 * Sizes differ per surface (78px at the dock, 70px in reception, 62px on
 * mobile), so `size` is a prop rather than four copies of the component.
 */

const SIZES = {
  lg: { box: 'h-[78px] px-5', code: 'text-[30px]', caret: 'h-[34px]' },
  md: { box: 'h-[70px] px-5', code: 'text-[26px]', caret: 'h-[30px]' },
  sm: { box: 'h-[62px] px-4', code: 'text-[17px]', caret: 'h-[22px]' },
} as const;

interface ScanFieldProps {
  onScan: (code: string) => void;
  size?: keyof typeof SIZES;
  helperText?: string;
  placeholder?: string;
  /** Accessible name. Set it when a screen has more than one scan field. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Reports when the field gains or loses focus. A scanner gun types into
   * whatever is focused: without focus, the trigger fires and nothing is
   * recorded. The screen passing this renders "Lector listo" or "Toca para
   * reactivar el lector" (spec-62, mock 3q).
   */
  onFocusStateChange?: (focused: boolean) => void;
}

function BarcodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M3 5v14M6.5 5v14M10 5v14M13.5 5v14M17 5v14M20.5 5v14" />
    </svg>
  );
}

export function ScanField({
  onScan,
  size = 'lg',
  helperText,
  placeholder,
  ariaLabel = 'Código de barras',
  disabled = false,
  className,
  onFocusStateChange,
}: ScanFieldProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const s = SIZES[size];

  // Keep focus on the field. A scanner gun types into whatever is focused, so
  // losing focus silently drops scans — the operator keeps working and nothing
  // records.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function submit(raw: string) {
    if (disabled) return;
    const code = raw.trim();
    if (!code) return;
    autoSubmit.reset();
    onScan(code);
    setValue('');
  }

  // Scanner guns without a CR/Enter suffix never trigger the Enter path —
  // their burst is detected by inter-key timing and submitted automatically.
  const autoSubmit = useScannerAutoSubmit(submit);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value);
    autoSubmit.handleValueChange(e.target.value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit(value);
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border-2 border-accent bg-accent-muted',
        'shadow-[0_0_0_4px_rgba(230,193,92,.10)]',
        s.box,
        disabled && 'opacity-60',
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <BarcodeIcon className="h-[26px] w-[26px] flex-none text-accent" />

      <input
        ref={inputRef}
        type="text"
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocusStateChange?.(true)}
        onBlur={() => onFocusStateChange?.(false)}
        // Native focus ring removed: the container already carries the accent
        // border and halo, so a second ring inside it reads as a defect.
        className={cn(
          'min-w-0 flex-1 bg-transparent font-mono font-semibold tracking-[.02em] text-text',
          'outline-none placeholder:text-text-muted placeholder:font-normal',
          s.code,
        )}
      />

      {/* Blinking caret stand-in — tells the operator at a glance the field is
          live and waiting, from a couple of metres away. */}
      <span className={cn('w-0.5 flex-none bg-accent motion-safe:animate-pulse', s.caret)} aria-hidden="true" />

      {helperText && (
        <span className="ml-auto hidden shrink-0 pl-2 text-xs text-text-muted sm:inline">
          {helperText}
        </span>
      )}
    </div>
  );
}
