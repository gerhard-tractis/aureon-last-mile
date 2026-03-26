'use client';
import { useRef, useState, useEffect } from 'react';

interface Props {
  onScan: (code: string) => void;
  disabled: boolean;
  lastError: string | null;
}

export function ScanZone({ onScan, disabled, lastError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, lastError]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !value.trim() || disabled) return;
    e.preventDefault();
    onScan(value.trim());
    setValue('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="px-5 pt-3.5 pb-3 bg-accent-muted border-b border-accent/25">
      <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-accent mb-2 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
        Escáner activo
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Escanea barcode, QR o número de orden…"
        autoComplete="off"
        className="w-full h-13 bg-background border-[1.5px] border-accent rounded-[10px] text-text font-mono text-base px-4 outline-none"
      />
      {lastError && (
        <p className="text-xs text-status-error mt-1.5">{lastError}</p>
      )}
      <p className="text-[11px] text-accent/70 mt-1.5">
        Acepta código de paquete · número de orden · QR code
      </p>
    </div>
  );
}
