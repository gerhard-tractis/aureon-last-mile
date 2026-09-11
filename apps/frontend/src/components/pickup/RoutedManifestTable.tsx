'use client';

import { cn } from '@/lib/utils';
import { formatDurationSince } from '@/lib/orders/duration';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';

/**
 * spec-94 fase 2 — cubo 2, "En punto de retiro". A dedicated table, NOT a
 * ninth column on `ManifestTable` (that grid is already fixed-pixel at
 * eight columns and the file is already 232 lines) — ruta · líder ·
 * abierta hace · bultos · chip de cierre · acciones. "Acciones" ("Ver
 * ruta" / "Quitar de la ruta") is spec-94 fase 3, not this phase; the
 * column exists here so fase 3 does not have to touch the grid shape.
 *
 * `RoutedManifest` rows stay snake_case, unmapped — same pattern
 * `RouteManifestList`'s `RouteManifestRow` already uses for a pickup RPC
 * row, not every pickup table goes through `ManifestRow`'s camelCase shape.
 */
const GRID = 'grid grid-cols-[1fr_120px_100px_72px_110px_140px] gap-3';

interface RoutedManifestTableProps {
  rows: RoutedManifest[];
  emptyMessage: string;
  /** Injected for deterministic tests — "abierta hace" reads how far "now"
   * is from route_started_at. */
  now?: Date;
}

export function RoutedManifestTable({ rows, emptyMessage, now }: RoutedManifestTableProps) {
  const clock = now ?? new Date();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          GRID,
          'flex-none border-b border-border bg-background px-4 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[.09em] text-text-secondary',
        )}
      >
        <span>Carga</span>
        <span>Ruta</span>
        <span>Líder</span>
        <span className="text-right">Bultos</span>
        <span>Abierta hace</span>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">{emptyMessage}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              data-testid="routed-manifest-row"
              className="grid grid-cols-[1fr_120px_100px_72px_110px_140px] items-center gap-3 border-b border-l-[3px] border-border-subtle border-l-transparent px-4 py-3"
            >
              <div className="min-w-0">
                <span className="block truncate font-mono text-[11.5px] font-semibold text-text">
                  {row.external_load_id}
                </span>
                <span className="block truncate text-[10.5px] text-text-secondary">
                  {row.retailer_name ?? 'Sin cliente'}
                </span>
              </div>

              <span className="truncate font-mono text-[11px] text-text-secondary">
                {row.route_code}
              </span>

              <span className="truncate text-[11.5px] text-text-secondary">
                {row.driver_name ?? '—'}
              </span>

              <span className="text-right font-mono text-[11.5px] font-semibold text-text">
                {row.total_packages ?? '—'}
              </span>

              <span className="font-mono text-[11px] text-text-secondary">
                {formatDurationSince(row.route_started_at, clock)}
              </span>

              {row.closed_at ? (
                <span
                  data-testid="closed-chip"
                  className={cn(
                    'inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                    row.missing_count > 0
                      ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
                      : 'border-status-success-border bg-status-success-bg text-status-success-text',
                  )}
                >
                  cerrada{' '}
                  {new Date(row.closed_at).toLocaleTimeString('es-CL', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {row.missing_count > 0
                    ? ` · ${row.missing_count} ${row.missing_count === 1 ? 'faltante' : 'faltantes'}`
                    : ''}
                </span>
              ) : (
                <span />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
