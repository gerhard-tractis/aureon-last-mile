import { cn } from '@/lib/utils';
import type { DispatchStatus } from '@/lib/dispatch/types';

export type OrderStatus = 'pending' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type StatusBadgeKind = 'order' | 'package' | 'dispatch';

interface StatusBadgeProps {
  status: OrderStatus | string;
  /**
   * Which enum's vocabulary `status` belongs to. `orders.leading_status`
   * (`order_status_enum`) and `packages.status`/`package_status`
   * (`package_status_enum`) overlap almost entirely by string value but
   * disagree on grammatical gender in Spanish ("la orden entregadA" vs "el
   * paquete entregadO") and package_status_enum has six values order
   * status never takes (sectorizado, retenido, retorno_hub, devuelto,
   * dañado, extraviado). Defaults to 'order' — every pre-existing call
   * site fed order-ish statuses before this prop existed.
   */
  kind?: StatusBadgeKind;
  variant?: BadgeVariant;
  /**
   * Bypasses BOTH the config lookup and the raw-status fallback. For
   * vocabularies StatusBadge doesn't model at all (route status, ad hoc
   * literal strings) — the caller already resolved its own label and just
   * wants the shared badge chrome, not a second guess at what `status`
   * means.
   */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

interface StatusConfigEntry {
  variant: BadgeVariant;
  label: string;
}

/**
 * `orders.leading_status` / `order_status_enum` (Pedidos, `/app/orders`,
 * and every other screen that already fed this vocabulary in before the
 * package one existed — OrdersTable, OrderInspector, MobileOrderCard,
 * OrderDetailSheet). Feminine endings ("Entregada", not "Entregado") match
 * the Aureon Rebrand mock's own badge text (ENTREGADA, REINGRESO) — the
 * mock reads these as "la orden", even though the nav item is "Pedidos".
 *
 * The six legacy English keys at the top (delivered/in_transit/etc.)
 * predate spec-65 and aren't `order_status_enum` values — kept here,
 * under the default vocabulary, so no existing caller passing them
 * changes behaviour.
 */
const ORDER_STATUS_CONFIG: Record<string, StatusConfigEntry> = {
  delivered:  { variant: 'success', label: 'Entregado' },
  in_transit: { variant: 'warning', label: 'En Ruta' },
  failed:     { variant: 'error',   label: 'Fallido' },
  picked_up:  { variant: 'info',    label: 'Recogido' },
  pending:    { variant: 'neutral', label: 'Pendiente' },
  returned:   { variant: 'error',   label: 'Devuelto' },

  ingresado:              { variant: 'neutral', label: 'Ingresado' },
  verificado:             { variant: 'neutral', label: 'Verificado' },
  en_bodega:              { variant: 'neutral', label: 'En bodega' },
  asignado:               { variant: 'info',    label: 'Asignado' },
  en_carga:               { variant: 'info',    label: 'En carga' },
  listo_para_despacho:    { variant: 'info',    label: 'Listo para despacho' },
  en_ruta:                { variant: 'warning', label: 'En reparto' },
  entregado:              { variant: 'success', label: 'Entregada' },
  cancelado:              { variant: 'error',   label: 'Cancelada' },
  en_retorno:             { variant: 'neutral', label: 'En retorno' },
  parcialmente_entregado: { variant: 'warning', label: 'Parcialmente entregada' },
};

/**
 * `packages.status` / `package_status_enum` — a DIFFERENT enum from
 * `order_status_enum` that happens to share most of its string values.
 * Masculine endings ("Entregado") agree with "el paquete", the opposite
 * choice from `ORDER_STATUS_CONFIG`'s "Entregada" — that grammatical
 * disagreement is the whole reason two maps exist instead of one shared
 * table. Entries are NOT shared with `ORDER_STATUS_CONFIG` even where the
 * key and intent match, to keep that agreement explicit per vocabulary
 * rather than accidentally-correct.
 *
 * Covers every `package_status_enum` value (`lib/types.ts`), including the
 * six order status never takes: sectorizado, retenido, retorno_hub,
 * devuelto, dañado, extraviado. `pending` is not a real enum value — it's
 * `PackageStatusBreakdown`'s own fallback for a null `status` column.
 */
const PACKAGE_STATUS_CONFIG: Record<string, StatusConfigEntry> = {
  pending:                { variant: 'neutral', label: 'Pendiente' },

  ingresado:              { variant: 'neutral', label: 'Ingresado' },
  verificado:             { variant: 'neutral', label: 'Verificado' },
  en_bodega:              { variant: 'neutral', label: 'En bodega' },
  sectorizado:            { variant: 'info',    label: 'Sectorizado' },
  retenido:               { variant: 'error',   label: 'Retenido' },
  asignado:               { variant: 'info',    label: 'Asignado' },
  en_carga:               { variant: 'info',    label: 'En carga' },
  listo_para_despacho:    { variant: 'info',    label: 'Listo para despacho' },
  en_ruta:                { variant: 'warning', label: 'En reparto' },
  retorno_hub:            { variant: 'warning', label: 'En retorno' },
  entregado:              { variant: 'success', label: 'Entregado' },
  cancelado:              { variant: 'error',   label: 'Cancelado' },
  devuelto:               { variant: 'error',   label: 'Devuelto' },
  dañado:                 { variant: 'error',   label: 'Dañado' },
  extraviado:             { variant: 'error',   label: 'Extraviado' },
};

/**
 * `dispatches.status` / `dispatch_status_enum` — spec-70 phase 4. A THIRD
 * vocabulary, not a rename of either above: it is the routing provider's
 * delivery outcome for a stop, written by the DT webhooks, and it takes
 * `'partial'`, a value neither `order_status_enum` nor `package_status_enum`
 * has. Before this existed, `PackageRow` fed these four values through
 * `kind="package"` under a field literally typed `PackageStatus` — 'partial'
 * had no entry there and fell back to the raw string, and 'pending' silently
 * matched `PACKAGE_STATUS_CONFIG`'s unrelated null-status fallback. See
 * `RoutePackage.status` in `lib/dispatch/types.ts`.
 */
const DISPATCH_STATUS_CONFIG: Record<DispatchStatus, StatusConfigEntry> = {
  pending:   { variant: 'neutral', label: 'Pendiente' },
  delivered: { variant: 'success', label: 'Entregado' },
  failed:    { variant: 'error',   label: 'Fallido' },
  partial:   { variant: 'warning', label: 'Parcial' },
};

const STATUS_CONFIG_BY_KIND: Record<StatusBadgeKind, Record<string, StatusConfigEntry>> = {
  order: ORDER_STATUS_CONFIG,
  package: PACKAGE_STATUS_CONFIG,
  dispatch: DISPATCH_STATUS_CONFIG,
};

// spec-54: text now comes from the -text tokens rather than the base hue. The
// base hue is a fill colour — #10b981 on #ecfdf5 is a pale green on a paler
// green. -text (#047857) is the readable pairing the prototype uses.
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-status-success-bg text-status-success-text border-status-success-border',
  warning: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  error:   'bg-status-error-bg text-status-error-text border-status-error-border',
  info:    'bg-status-info-bg text-status-info border-status-info-border',
  neutral: 'bg-surface-raised text-text-secondary border-border',
};

/** Same lookup StatusBadge uses internally — exposed for callers (e.g. filter chips) that need the label as plain text, not inside a badge. */
export function getStatusLabel(status: string, kind: StatusBadgeKind = 'order'): string {
  return STATUS_CONFIG_BY_KIND[kind][status]?.label ?? status;
}

export function StatusBadge({ status, kind = 'order', variant, label, size = 'md', className }: StatusBadgeProps) {
  const config = STATUS_CONFIG_BY_KIND[kind][status];
  const resolvedVariant = variant ?? config?.variant ?? 'neutral';
  const resolvedLabel = label ?? config?.label ?? status;

  return (
    <span
      className={cn(
        // Rounded-sm, not a pill: the rebrand reserves pills for filter chips,
        // and a square-ish badge sits better against tabular rows.
        'inline-flex items-center rounded-sm border font-semibold',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1.5 py-[3px] text-[10.5px]',
        VARIANT_CLASSES[resolvedVariant],
        className,
      )}
    >
      {resolvedLabel}
    </span>
  );
}
