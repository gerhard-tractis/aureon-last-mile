import type { DTDispatch, DTItem } from '@/lib/dispatchtrack-api';

interface SkuLine { sku?: unknown; description?: unknown; quantity?: unknown }

/** A package as read off the `dispatches -> orders -> packages` embed built
 * by the dispatch handler's own select. `status` and `id` are what spec-79
 * H3 needs to scope the post-DT `en_ruta` write to boxes actually loaded —
 * everything else here is what the DT guide-contents payload needs. */
export interface PackageRow {
  id: string;
  label: string | null;
  sku_items: unknown;
  status: string | null;
  deleted_at: string | null;
}

export interface OrderRow {
  order_number: string | null | undefined;
  customer_name: string | null;
  delivery_address: string | null;
  customer_phone: string | null;
  packages?: PackageRow[];
}

export interface DispatchRow {
  id: string;
  order_id: string | null;
  orders: OrderRow | OrderRow[] | null;
}

function singleOrder(d: DispatchRow): OrderRow | null {
  return Array.isArray(d.orders) ? (d.orders[0] ?? null) : d.orders;
}

/**
 * The guide's contents, as DispatchTrack shows them.
 *
 * One item per package rather than per SKU line: `code` is DT's only unique
 * identifier slot on an item, and the package label is what the operator
 * actually handles and scans, so that is what belongs there. A package holding
 * several SKUs folds into one item — its codes and descriptions joined, its
 * quantities summed — which keeps every code unique within the guide.
 *
 * A package with no SKU data still produces an item, so a guide always lists
 * the packages it consists of.
 */
export function buildItems(packages: PackageRow[] | null | undefined): DTItem[] {
  return (packages ?? [])
    .filter((p) => !p.deleted_at && p.label)
    .map((p) => {
      const lines: SkuLine[] = Array.isArray(p.sku_items) ? p.sku_items : [];
      const names: string[] = [];
      const descriptions: string[] = [];
      let quantity = 0;

      for (const line of lines) {
        if (typeof line?.sku === 'string' && line.sku) names.push(line.sku);
        if (typeof line?.description === 'string' && line.description) {
          descriptions.push(line.description);
        }
        quantity += typeof line?.quantity === 'number' ? line.quantity : 1;
      }

      const item: DTItem = { code: p.label as string };
      if (names.length) item.name = names.join(', ');
      if (descriptions.length) item.description = descriptions.join(', ');
      item.quantity = String(quantity || 1);
      return item;
    });
}

/** Dispatches whose order carries no usable guide number — DT cannot be
 * asked to create a route for these. */
export function findMissingOrderNumbers(dispatches: DispatchRow[]): DispatchRow[] {
  return dispatches.filter((d) => !singleOrder(d)?.order_number?.trim());
}

// dispatches.identifier is DT's guide number, and order_number IS that
// number: the inbound beetrack-webhook matches on `order_number =
// body.identifier`, and scripts/sync-pending-orders.mjs looks guides up as
// GET /dispatches/:order_number. So it goes out verbatim.
//
// Guide numbers are not always numeric — the format follows Musan's client,
// so some are digits and some are alphanumeric strings. DT's docs type the
// field Integer, but its own webhooks send it as a string ("2916967493"),
// and the string form is what both sides already match on. Numeric ones are
// sent as numbers to match the documented type; anything else goes as the
// string it is. What must never happen is the previous behaviour,
// parseInt(order_number.replace(/\D/g, '')), which invented a different
// number for non-numeric guides and NaN (JSON null) for those with no
// digits — a guide matching nothing on either side.
export function buildDtDispatches(dispatches: DispatchRow[]): DTDispatch[] {
  return dispatches.map((d) => {
    const ord = singleOrder(d);
    const orderNumber = (ord?.order_number ?? '').trim();
    const asNumber = Number(orderNumber);
    return {
      identifier:
        /^\d+$/.test(orderNumber) && Number.isSafeInteger(asNumber)
          ? asNumber
          : orderNumber,
      contact_name: ord?.customer_name ?? null,
      contact_address: ord?.delivery_address ?? null,
      contact_phone: ord?.customer_phone ?? null,
      contact_email: null,
      current_state: 1,
      items: buildItems(ord?.packages),
    };
  });
}

/**
 * spec-79 H3: which packages actually rode the truck. `en_carga` is what
 * `/scan` (spec-74) writes per bulto as it gets loaded — the only direct
 * fact of "this box is on the vehicle". A package still `asignado` (never
 * scanned) or `retenido` (held back in consolidation) must not be counted
 * here, or it will be written to `en_ruta` alongside boxes that never left
 * the dock.
 */
export function loadedPackageIds(dispatches: DispatchRow[]): string[] {
  return dispatches.flatMap((d) => {
    const pkgs = singleOrder(d)?.packages ?? [];
    return pkgs
      .filter((p) => !p.deleted_at && p.status === 'en_carga')
      .map((p) => p.id);
  });
}
