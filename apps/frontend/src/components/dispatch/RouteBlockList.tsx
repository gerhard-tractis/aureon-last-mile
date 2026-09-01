'use client';
import { useState } from 'react';
import { ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { useRouteBlocks } from '@/hooks/dispatch/useRouteBlocks';
import { LOADABLE_ROUTE_STATUSES, type RouteStatus } from '@/lib/dispatch/types';

interface Props {
  routeId: string;
  operatorId: string;
  /**
   * spec-72 phase 3 review item 1: reordering (and, review item 2,
   * appending orphans into the sequence) is only meaningful while the
   * route is still in `LOADABLE_ROUTE_STATUSES` (draft/planned/loading) —
   * the same window `packages/[pkgId]` DELETE gates removal on, and the
   * exact window `move_route_block`/`seed_default_route_blocks` enforce
   * server-side (ROUTE_SEALED, P0001 -> 409). Undefined (route not loaded
   * yet) is treated as not-editable — the safe default, matching
   * RouteBuilder's own `canLoad` derivation.
   */
  routeStatus: RouteStatus | undefined;
}

/**
 * spec-72 phase 3 — the manager review list on the route builder.
 *
 * Non-Goals (spec-72, strict): no drag-and-drop, no map, no geocoding, no
 * optimisation. Reordering is two buttons per row that call
 * `PATCH /api/dispatch/routes/[id]/blocks/[blockId]`, which delegates the
 * actual swap to `move_route_block` — this component owns none of the
 * reorder logic, only the click-and-refetch.
 *
 * MANDATORY per spec-72 phase 3: `useRouteBlocks` never treats
 * `route_blocks` as a complete manifest — every order missing a block is
 * returned as `unblocked`, split by reason (`noComuna` vs `orphan`), and
 * both render here rather than vanishing off the screen. An empty-draft
 * route (no blocks at all, `createEmptyDraft` never seeds any) still shows
 * every one of its orders this way instead of rendering as if the route had
 * nothing planned.
 *
 * Review item 2: an `orphan` row (comuna_id set, no live block covering it —
 * the scan-adopt / empty-draft gap) is not just displayed, it is actionable:
 * "Agregar a la secuencia" calls `POST /api/dispatch/routes/[id]/blocks`,
 * which re-runs `seed_default_route_blocks` and appends a block for every
 * such comuna.
 */
export function RouteBlockList({ routeId, operatorId, routeStatus }: Props) {
  const { data, isLoading, refetch } = useRouteBlocks(routeId, operatorId);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const blocks = data?.blocks ?? [];
  const unblocked = data?.unblocked ?? [];
  const orphanCount = unblocked.filter((u) => u.reason === 'orphan').length;
  const canEdit = routeStatus != null && (LOADABLE_ROUTE_STATUSES as readonly string[]).includes(routeStatus);

  // Nothing to show yet, or nothing to show at all (a route with zero
  // dispatches has no blocks and no orphans either) — render nothing rather
  // than an empty shell.
  if (isLoading || (blocks.length === 0 && unblocked.length === 0)) return null;

  const handleMove = async (blockId: string, direction: 'up' | 'down') => {
    setMoveError(null);
    setMovingId(blockId);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/blocks/${blockId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMoveError(json.message ?? 'No se pudo reordenar el bloque');
        return;
      }
      await refetch();
    } finally {
      setMovingId(null);
    }
  };

  const handleSeedOrphans = async () => {
    setMoveError(null);
    setSeeding(true);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/blocks`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMoveError(json.message ?? 'No se pudo agregar a la secuencia');
        return;
      }
      await refetch();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="px-5 pt-2 text-[11px] text-text-muted uppercase tracking-[0.06em]">
        Secuencia de entrega por comuna
      </div>

      {moveError && (
        <div className="px-5 py-1.5 text-xs text-status-error">⚠ {moveError}</div>
      )}

      {blocks.length > 0 && (
        <ul className="px-3 py-2 space-y-1">
          {blocks.map((b, i) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-1.5 text-xs"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-text-muted shrink-0">{b.sequenceIndex}</span>
                <span className="font-medium truncate">{b.comunaName}</span>
                <span className="text-text-muted shrink-0">
                  {b.orderCount} orden{b.orderCount === 1 ? '' : 'es'} · {b.packageCount} bulto{b.packageCount === 1 ? '' : 's'}
                </span>
                {b.sequenceSource === 'manual' && (
                  <span className="text-[10px] text-text-muted shrink-0">(manual)</span>
                )}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label={`Mover ${b.comunaName} hacia arriba`}
                  disabled={i === 0 || movingId === b.id || !canEdit}
                  onClick={() => handleMove(b.id, 'up')}
                  className="text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Mover ${b.comunaName} hacia abajo`}
                  disabled={i === blocks.length - 1 || movingId === b.id || !canEdit}
                  onClick={() => handleMove(b.id, 'down')}
                  className="text-text-muted hover:text-accent disabled:opacity-30 disabled:hover:text-text-muted"
                >
                  <ChevronDown size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {unblocked.length > 0 && (
        <div className="px-5 pb-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-status-warning-text uppercase tracking-[0.06em]">
              Sin secuencia asignada
            </div>
            {orphanCount > 0 && (
              <button
                type="button"
                disabled={seeding || !canEdit}
                onClick={handleSeedOrphans}
                className="flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-30 disabled:hover:no-underline shrink-0"
              >
                <Plus size={12} />
                Agregar a la secuencia
              </button>
            )}
          </div>
          {/* Cap review item 4: unbounded, one line per order, sits directly
              above RouteBuilder's own flex-1 overflow-y-auto package list —
              the route with the most orphans is also the route with the
              most orders, so on a small screen this list could push that
              list off-screen entirely. Scrolls internally instead. */}
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {unblocked.map((u) => (
              <li key={u.orderId} className="text-xs text-text-muted">
                {u.orderNumber} —{' '}
                {u.reason === 'noComuna'
                  ? 'sin comuna'
                  : `sin bloque (${u.comunaName ?? 'comuna desconocida'})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
