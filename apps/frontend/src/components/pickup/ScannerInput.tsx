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

  // Auto-focus on mount and after each scan
  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onScan(value.trim());
      setValue('');
      // Re-focus after scan
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Re-focus if not disabled (hardware scanner needs focus)
          if (!disabled) {
            setTimeout(() => inputRef.current?.focus(), 100);
          }
        }}
        placeholder="Scan barcode..."
        disabled={disabled}
        className="text-lg font-mono"
        autoComplete="off"
        aria-label="Barcode scanner input"
      />
    </div>
  );
}
