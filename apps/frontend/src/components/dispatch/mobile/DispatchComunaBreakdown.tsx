'use client';

import type { ComunaCount } from '@/lib/dispatch/mobile/route-load-brief';

/** spec-76 2c — COMUNAS DE LA RUTA, per-comuna order counts. */
export interface DispatchComunaBreakdownProps {
  comunas: ComunaCount[];
}

export function DispatchComunaBreakdown({ comunas }: DispatchComunaBreakdownProps) {
  if (comunas.length === 0) return null;
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[.06em] text-text-muted">Comunas de la ruta</h2>
      <ul className="mt-2 space-y-1">
        {comunas.map((c) => (
          <li key={c.comuna} className="flex items-center justify-between text-[13px] text-text">
            <span>{c.comuna}</span>
            <span className="font-mono text-text-secondary">{c.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
