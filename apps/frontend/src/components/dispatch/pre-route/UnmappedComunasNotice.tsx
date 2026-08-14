'use client';

/**
 * spec-54 phase 4.2 — comunas with no dock zone.
 *
 * Their orders are invisible to the grouping above, so the notice states the
 * consequence rather than the fact: these orders cannot be routed until
 * someone maps the comuna.
 */

interface UnmappedComuna {
  id: string;
  name: string;
  order_count: number;
}

export function UnmappedComunasNotice({ comunas }: { comunas: UnmappedComuna[] }) {
  if (comunas.length === 0) return null;

  const orders = comunas.reduce((sum, c) => sum + c.order_count, 0);

  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-status-warning-border bg-status-warning-bg px-4 py-2.5">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-status-warning-text">
        Comunas sin zona
      </span>
      <span className="text-[11px] leading-none text-status-warning-text">
        {orders} {orders === 1 ? 'orden no se puede rutear' : 'órdenes no se pueden rutear'} hasta
        asignarles un andén:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {comunas.map((c) => (
          <span
            key={c.id}
            className="rounded-md border border-status-warning-border bg-surface px-1.5 py-1 text-[10.5px] font-medium leading-none text-status-warning-text"
          >
            {c.name} · {c.order_count}
          </span>
        ))}
      </div>
    </div>
  );
}
