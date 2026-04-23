'use client';

import React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { PreRouteSnapshot } from '@/lib/types';

type WindowOption = 'todas' | 'manana' | 'tarde' | 'noche';

const WINDOW_OPTIONS: { value: WindowOption; label: string }[] = [
  { value: 'todas',  label: 'Todas' },
  { value: 'manana', label: 'Mañana' },
  { value: 'tarde',  label: 'Tarde' },
  { value: 'noche',  label: 'Noche' },
];

type Props = {
  totals?: PreRouteSnapshot['totals'];
};

export function PreRouteFilters({ totals }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const params   = useSearchParams();

  const today  = new Date().toISOString().slice(0, 10);
  const date   = params.get('date') ?? today;
  const window = (params.get('window') ?? 'todas') as WindowOption;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border">
      <input
        type="date"
        value={date}
        onChange={(e) => setParam('date', e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="flex rounded-md border border-input overflow-hidden">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setParam('window', opt.value)}
            className={`px-3 py-1.5 text-sm transition-colors ${
              window === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {totals && (
        <span className="ml-auto text-sm text-muted-foreground">
          {totals.order_count} órdenes · {totals.package_count} bultos · {totals.anden_count} andenes
        </span>
      )}
    </div>
  );
}
