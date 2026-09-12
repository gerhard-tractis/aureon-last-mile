'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import { Package } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import { formatRelativeDeliveryDate } from '@/lib/distribution/relative-date';

/**
 * spec-96 fase 4 — `4a`'s "Consolidación" panel. Round 2 of the design
 * kept this full width but redrew it as a table grouped by ORDER, not the
 * card-per-package list this component had before this phase.
 *
 * The mock's `BULTOS` column reads "2 de 3" — packages currently in
 * consolidation for that order over the order's total package count.
 * That denominator isn't sourced anywhere today: `useConsolidation` only
 * fetches `status = 'retenido'` packages, never an order's full package
 * count, and adding that would be a genuinely new query axis (an
 * aggregate across ALL of an order's packages regardless of status), not
 * wiring an existing one. Declared gap: `data-testid="consolidation-bultos"`
 * renders only the numerator (`group.packageIds.length` — how many of the
 * order's bultos are currently held here), never "X de Y".
 *
 * Same gap on `ENTREGA`'s "HOY 18:00" — `orders.delivery_date` carries a
 * date, never a time, so this renders `AYER` / `HOY` / `DD MMM` (see
 * `deliveryLabel` below), never an invented hour.
 */
interface ConsolidationPanelProps {
  packages: ConsolidationPackage[];
  onRelease: (ids: string[]) => void;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

interface OrderGroup {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  comunaName: string | null;
  deliveryDate: string;
  packageIds: string[];
}

function groupByOrder(packages: ConsolidationPackage[]): OrderGroup[] {
  const map = new Map<string, OrderGroup>();
  for (const pkg of packages) {
    let group = map.get(pkg.order_id);
    if (!group) {
      group = {
        orderId: pkg.order_id,
        orderNumber: pkg.orderNumber ?? pkg.order_id,
        customerName: pkg.customerName ?? null,
        comunaName: pkg.comunaName,
        deliveryDate: pkg.delivery_date,
        packageIds: [],
      };
      map.set(pkg.order_id, group);
    }
    group.packageIds.push(pkg.id);
  }
  return Array.from(map.values());
}

/** `4a`'s three ENTREGA tones: `AYER` (overdue) is `error`, `HOY`/`mañana`
 *  are `warning`, anything further out is `neutral`. */
export type DeliveryTone = 'error' | 'warning' | 'neutral';

/**
 * Review fix — `date < today → 'AYER'` said AYER for ANY past delivery,
 * not just yesterday's. A week-late order read as one day late: false in
 * the reassuring direction on a triage queue, and zero test coverage
 * caught it (every fixture used one date).
 *
 * Review fix (round 2) — the first fix hand-rolled the "exactly
 * yesterday" comparison with `new Date(now)` + `setHours(0,0,0,0)`,
 * midnight in the RUNTIME's own timezone. This component is `'use
 * client'` but Next prerenders it server-side with `TZ=UTC`; late evening
 * in Santiago, the server's "today" was already tomorrow's UTC date — an
 * order due TODAY rendered `AYER` in red.
 *
 * `lib/distribution/relative-date.ts`'s `formatRelativeDeliveryDate`
 * already solves exactly this (spec-68's pendientes list uses it) — it
 * takes `todayISO` as a plain string, so it carries no runtime-timezone
 * dependency at all, and its own tone split already matches `4a`'s: `ayer`
 * is `overdue` (→ `error`), `hoy`/`mañana` are `urgent`/`soon` (→
 * `warning`). Reused instead of re-deriving the same "is this exactly
 * yesterday" logic a second, riskier way. Exported for a direct unit test
 * independent of the test runner's own timezone.
 */
export function deliveryLabel(deliveryDate: string, now: Date): { text: string; tone: DeliveryTone } {
  const todayISO = todayISOInTimezone(now);
  const { label, tone: relTone } = formatRelativeDeliveryDate(deliveryDate, todayISO);
  const tone: DeliveryTone =
    relTone === 'overdue' ? 'error' : relTone === 'urgent' || relTone === 'soon' ? 'warning' : 'neutral';
  return { text: label.toUpperCase(), tone };
}

export function ConsolidationPanel({ packages, onRelease, now = new Date() }: ConsolidationPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (packages.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin paquetes en consolidación"
        description="Los paquetes que necesiten consolidarse antes de despacho aparecerán aquí."
      />
    );
  }

  const groups = groupByOrder(packages);

  function toggle(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function releaseSelected() {
    const releasedOrderIds = groups.filter((g) => selected.has(g.orderId)).map((g) => g.orderId);
    const ids = groups.filter((g) => selected.has(g.orderId)).flatMap((g) => g.packageIds);
    onRelease(ids);
    // Review fix — the button stayed enabled with nothing visibly checked
    // after a release; a second click fired onRelease([]) (an UPDATE ...
    // .in('id', []) plus two cache invalidations for nothing).
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of releasedOrderIds) next.delete(id);
      return next;
    });
  }

  function releaseOrder(group: OrderGroup) {
    onRelease(group.packageIds);
    setSelected((prev) => {
      if (!prev.has(group.orderId)) return prev;
      const next = new Set(prev);
      next.delete(group.orderId);
      return next;
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <span className="font-heading text-[12.5px] font-semibold text-text">Consolidación</span>
        <span className="text-[11px] text-text-muted">
          órdenes retenidas esperando sus bultos hermanos
        </span>
        <span
          data-testid="consolidation-summary"
          className="rounded border border-status-warning-border bg-status-warning-bg px-1.5 py-1 font-mono text-[10.5px] font-semibold leading-none text-status-warning-text"
        >
          {packages.length} paq. · {groups.length} {groups.length === 1 ? 'orden' : 'órdenes'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={selected.size === 0}
          onClick={releaseSelected}
        >
          Liberar seleccionadas
        </Button>
      </div>

      <div className="grid grid-cols-[22px_118px_1fr_72px_96px_92px] items-center gap-3 border-b border-border bg-bg px-3.5 py-2">
        <span />
        <span className="text-[9.5px] font-medium uppercase tracking-wide text-text-secondary">
          Orden
        </span>
        <span className="text-[9.5px] font-medium uppercase tracking-wide text-text-secondary">
          Destinatario y comuna
        </span>
        <span className="text-right text-[9.5px] font-medium uppercase tracking-wide text-text-secondary">
          Bultos
        </span>
        <span className="text-right text-[9.5px] font-medium uppercase tracking-wide text-text-secondary">
          Entrega
        </span>
        <span />
      </div>

      {groups.map((group) => {
        const delivery = deliveryLabel(group.deliveryDate, now);
        return (
          <div
            key={group.orderId}
            data-testid="consolidation-order-row"
            className="grid grid-cols-[22px_118px_1fr_72px_96px_92px] items-center gap-3 border-b border-border-strong/20 px-3.5 py-2"
          >
            <input
              type="checkbox"
              aria-label={`Seleccionar ${group.orderNumber}`}
              checked={selected.has(group.orderId)}
              onChange={() => toggle(group.orderId)}
            />
            <span className="font-mono text-[11.5px] font-semibold text-text">
              {group.orderNumber}
            </span>
            <span className="truncate text-[11.5px] text-text-secondary">
              {group.customerName ?? 'Sin destinatario'}
              {group.comunaName ? ` · ${group.comunaName}` : ''}
            </span>
            <span
              data-testid="consolidation-bultos"
              className="text-right font-mono text-[11.5px] font-semibold text-status-warning-text"
            >
              {group.packageIds.length}
            </span>
            <span
              className={
                'text-right font-mono text-[11px] ' +
                (delivery.tone === 'error'
                  ? 'text-status-error-text'
                  : delivery.tone === 'warning'
                    ? 'text-status-warning-text'
                    : 'text-text-secondary')
              }
            >
              {delivery.text}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="justify-self-end"
              onClick={() => releaseOrder(group)}
            >
              Liberar
            </Button>
          </div>
        );
      })}
    </div>
  );
}
