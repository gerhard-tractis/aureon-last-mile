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
    <div
      style={{
        padding: '14px 20px 12px',
        background: 'var(--color-accent-muted)',
        borderBottom: '1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
      }}
    >
      <div
        style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--color-accent)',
          marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)',
            display: 'inline-block',
          }}
        />
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
        style={{
          width: '100%', minHeight: 52,
          background: 'var(--color-background)',
          border: '1.5px solid var(--color-accent)',
          borderRadius: 10, color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)', fontSize: 16,
          padding: '0 16px', outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {lastError && (
        <p style={{ fontSize: 12, color: 'var(--color-status-error, #e53e3e)', marginTop: 6 }}>
          {lastError}
        </p>
      )}
      <p style={{ fontSize: 11, color: 'var(--color-accent)', opacity: 0.7, marginTop: 6 }}>
        Acepta código de paquete · número de orden · QR code
      </p>
    </div>
  );
}
