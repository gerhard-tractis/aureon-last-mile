"use client";

import { useEffect, useState } from 'react';

export interface TopBarProps {
  warehouseCode?: string;
  now?: Date;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('es-CL', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function TopBar({ warehouseCode, now }: TopBarProps) {
  const [tick, setTick] = useState<Date>(now ?? new Date());

  useEffect(() => {
    if (now) {
      setTick(now);
      return;
    }
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, [now]);

  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b"
      style={{ background: 'var(--color-background)', borderColor: 'var(--color-border)' }}
    >
      {/* Left: brand */}
      <div
        className="flex items-center gap-2 text-sm tracking-widest uppercase"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)' }}
      >
        <span style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
          Aureon
        </span>
        <span style={{ color: 'var(--color-border-subtle)' }}>·</span>
        <span>Control de Operaciones</span>
        <span style={{ color: 'var(--color-border-subtle)' }}>·</span>
        <span style={{ color: 'var(--color-status-info)' }}>Mission Deck</span>
      </div>

      {/* Right: warehouse + date + clock + live dot */}
      <div
        className="flex items-center gap-4 text-xs"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}
      >
        {warehouseCode && (
          <span
            className="px-2 py-0.5 rounded border text-xs tracking-widest"
            style={{
              color: 'var(--color-text)',
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
            }}
          >
            {warehouseCode}
          </span>
        )}

        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatDate(tick)}
        </span>

        <span
          data-testid="clock-time"
          style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}
        >
          {formatTime(tick)}
        </span>

        {/* EN VIVO pulsing indicator */}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--color-status-success)' }}
            aria-hidden="true"
          />
          <span
            className="tracking-widest text-xs"
            style={{ color: 'var(--color-status-success)', fontFamily: 'var(--font-sans)' }}
          >
            EN VIVO
          </span>
        </span>
      </div>
    </header>
  );
}
