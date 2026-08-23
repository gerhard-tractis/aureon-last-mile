/**
 * spec-65 Task 5 — Spanish label + `StatusBadge` variant for every
 * `orders.leading_status` value (`order_status_enum` in the database).
 *
 * Deliberately NOT added to `StatusBadge.tsx`'s own `STATUS_CONFIG`: that
 * map already renders these exact enum values today via its "no match ->
 * show the raw string" fallback, and `PackageStatusBreakdown.test.tsx`
 * pins that fallback text (`'en_ruta'`, `'entregado'`) for two of them.
 * Adding entries there would silently change what that unrelated screen
 * renders. `<StatusBadge status={label} variant={variant} />`, fed the
 * resolved label as `status`, gets the same visual component without
 * touching the shared config.
 */

import type { BadgeVariant } from '@/components/StatusBadge';

export interface OrderStatusDisplay {
  label: string;
  variant: BadgeVariant;
}

export const ORDER_STATUS_DISPLAY: Readonly<Record<string, OrderStatusDisplay>> = Object.freeze({
  ingresado: { label: 'Ingresado', variant: 'neutral' },
  verificado: { label: 'Verificado', variant: 'neutral' },
  en_bodega: { label: 'En bodega', variant: 'neutral' },
  asignado: { label: 'Asignado', variant: 'info' },
  en_carga: { label: 'En carga', variant: 'info' },
  listo_para_despacho: { label: 'Listo para despacho', variant: 'info' },
  en_ruta: { label: 'En reparto', variant: 'warning' },
  entregado: { label: 'Entregada', variant: 'success' },
  cancelado: { label: 'Cancelada', variant: 'error' },
  en_retorno: { label: 'En retorno', variant: 'neutral' },
  parcialmente_entregado: { label: 'Parcialmente entregada', variant: 'warning' },
});

/** Unknown values fall back to the raw status text, never a placeholder — the same rule event-decoder.ts and resolvePreset follow for anything that could arrive from outside this module's control. */
export function displayForOrderStatus(status: string): OrderStatusDisplay {
  return ORDER_STATUS_DISPLAY[status] ?? { label: status, variant: 'neutral' };
}
