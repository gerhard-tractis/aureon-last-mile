'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { formatDurationSince } from '@/lib/orders/duration';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRemoveManifestFromRoute } from '@/hooks/pickup/useRemoveManifestFromRoute';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';

/**
 * spec-94 fase 2/3 — cubo 2, "En punto de retiro". A dedicated table, NOT a
 * ninth column on `ManifestTable` (that grid is already fixed-pixel at
 * eight columns and the file is already 232 lines) — ruta · líder ·
 * abierta hace · bultos · chip de cierre · acciones.
 *
 * `RoutedManifest` rows stay snake_case, unmapped — same pattern
 * `RouteManifestList`'s `RouteManifestRow` already uses for a pickup RPC
 * row, not every pickup table goes through `ManifestRow`'s camelCase shape.
 */
const GRID = 'grid grid-cols-[1fr_120px_100px_72px_110px_140px_230px] gap-3';

/**
 * spec-94 fase 3 — "Quitar de la ruta" se deshabilita, con la razón escrita
 * en la propia fila, en tres casos (ver la tabla del spec). PRECEDENCIA,
 * decidida aquí porque el spec deja abierto qué mostrar cuando más de una
 * es cierta a la vez: `closed_at` primero. Una carga cerrada y firmada no
 * se toca pase lo que pase con `verified_count` o `route_status` — es la
 * condición más severa (irreversible: borraría una firma real) y la única
 * que el usuario necesita leer primero. `verified_count` va segundo porque
 * es la guarda que el RPC YA aplica (guarda 7); `route_status` va último
 * porque, en la práctica, una fila de este cubo casi siempre tiene la ruta
 * en `in_progress` (el cubo 2 ya excluye `in_transit`/`received`).
 *
 * `route_status` se trata como potencialmente ausente (`!row.route_status`)
 * aunque el docstring de `RoutedManifest` diga que el RPC nunca lo emite en
 * NULL — es la mitad "IS NULL" de la guarda 2/3 del RPC (spec-64), y este
 * chequeo es defensivo por si esa garantía cambia aguas arriba.
 */
function getRemoveDisabledReason(row: RoutedManifest): string | null {
  if (row.closed_at) {
    return 'la carga ya está cerrada y firmada: quitarla borraría la firma';
  }
  if (row.verified_count > 0) {
    return `ya tiene ${row.verified_count} bultos verificados; debe cerrarse desde la ruta`;
  }
  if (!row.route_status || row.route_status !== 'in_progress') {
    return 'la ruta ya no admite cambios';
  }
  return null;
}

/**
 * Review ronda 2 (fase 3), decisión B — `remove_manifest_from_route`
 * (spec-64, 20260824000004) ya tradujo las guardas 4 y 6 a español porque
 * el hook las rethrows verbatim; las guardas 3 y 7 se libraron en esa
 * migración sólo porque nunca fueron alcanzables desde móvil (`route/
 * active/page.tsx`, único consumidor hasta esta fase). Bajo el
 * `staleTime` de 30s de `PICKUP_QUERY_OPTIONS`, esta pantalla SÍ puede
 * mostrar una fila hasta un minuto desactualizada, así que ambas son
 * alcanzables aquí — sin este mapeo, un supervisor vería inglés crudo con
 * UUID en una pantalla en español. NO se toca el mensaje del RPC (eso
 * reemitiría una función de otra migración); el mapeo vive sólo en el
 * frontend, por substring, porque el RPC interpola el id de ruta/manifiesto
 * dentro del mensaje y no hay forma de matchear exacto.
 *
 * Devuelve `null` (no traducido) para cualquier otro error del RPC — las
 * guardas 4 y 6 ya llegan en español, y las demás (1, 2, 5, JWT) no son
 * "la fila está vieja", así que no se refetchea nada por ellas.
 */
function translateStaleRemoveError(message: string): string | null {
  if (message.includes('is not in_progress')) {
    return 'La ruta ya no admite cambios (salió o cambió de estado). Esta fila estaba desactualizada.';
  }
  if (message.includes('has verified scans and cannot be removed')) {
    return 'La carga ya tiene bultos verificados; debe cerrarse desde la ruta. Esta fila estaba desactualizada.';
  }
  return null;
}

interface RoutedManifestTableProps {
  rows: RoutedManifest[];
  emptyMessage: string;
  /** Injected for deterministic tests — "abierta hace" reads how far "now"
   * is from route_started_at. */
  now?: Date;
}

export function RoutedManifestTable({ rows, emptyMessage, now }: RoutedManifestTableProps) {
  const clock = now ?? new Date();
  const { operatorId } = useOperatorId();
  const removeMut = useRemoveManifestFromRoute(operatorId);
  const qc = useQueryClient();
  // Ronda 2 de review — `removeMut.isPending` es UN booleano por tabla
  // (un solo `useMutation`), así que deshabilitaba las DOS filas apenas
  // cualquier remoción estaba en curso. `removingId` aísla el disabled al
  // botón que de verdad se está procesando.
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemove = (row: RoutedManifest) => {
    // Ronda 2 de review — mismo patrón que route/active/page.tsx:291-295
    // documenta a propósito: useRemoveManifestFromRoute cierra sobre
    // operatorId para sus invalidateQueries, así que llamar mutate() con
    // null invalidaría queries que no matchean nada.
    if (!operatorId) return;
    setRemovingId(row.id);
    removeMut.mutate(
      { routeId: row.pickup_route_id, manifestId: row.id },
      {
        onSuccess: () => toast.success('Carga quitada de la ruta'),
        onError: (err) => {
          const translated = translateStaleRemoveError(err.message);
          toast.error(translated ?? err.message);
          if (translated) {
            qc.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
          }
        },
        onSettled: () => setRemovingId(null),
      },
    );
  };

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
        <span>Acciones</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-secondary">{emptyMessage}</p>
        ) : (
          rows.map((row) => {
            const disabledReason = getRemoveDisabledReason(row);
            return (
              <div
                key={row.id}
                data-testid="routed-manifest-row"
                className={cn(GRID, 'items-center border-b border-l-[3px] border-border-subtle border-l-transparent px-4 py-3')}
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

                <span data-testid="driver-name" className="truncate text-[11.5px] text-text-secondary">
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

                <div className="flex min-w-0 flex-col items-start gap-1">
                  <div className="flex items-center gap-2">
                    {/* Review ronda 2 — rótulo corregido de "Ver ruta" a "QR
                        de entrega": el destino (RouteQRView, título "Entrega
                        en bodega — Muestra este QR al receptor") es una
                        pantalla de tripulación para mostrarle el QR al
                        receptor del hub, no un detalle de ruta. No existe
                        hoy una pantalla de detalle de ruta para supervisor
                        (queda anotado en el spec como trabajo futuro).
                        `reception/route/[routeId]/preview` también resuelve
                        una ruta arbitraria por id sin gating de driver_id,
                        pero lleva `ReceiveWithoutQRButton` — una acción que
                        estampa una llegada falsa, y eso no se le pone
                        delante a un supervisor por error. */}
                    <Link
                      href={`/app/pickup/route/${row.pickup_route_id}/qr`}
                      className="rounded-md border border-border px-2 py-1 text-[10.5px] font-medium text-text-secondary hover:bg-background-muted"
                    >
                      QR de entrega
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemove(row)}
                      disabled={!!disabledReason || removingId === row.id}
                      title={disabledReason ?? undefined}
                      className="rounded-md border border-border px-2 py-1 text-[10.5px] font-medium text-text-secondary hover:bg-background-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Quitar de la ruta
                    </button>
                  </div>
                  {disabledReason ? (
                    <span
                      data-testid="remove-disabled-reason"
                      className="text-[9.5px] leading-tight text-text-secondary"
                    >
                      {disabledReason}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
