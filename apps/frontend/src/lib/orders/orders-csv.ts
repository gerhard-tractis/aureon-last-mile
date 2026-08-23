/**
 * spec-65 Task 4 — CSV export for the Pedidos bulk bar's "Exportar" action
 * (spec-65 Decision 3: the only bulk action with no backend — it never
 * touches Supabase, it just formats the rows already in memory).
 *
 * Pure string in, string out. Triggering the actual browser download is
 * Task 5's job (a component); this module does not touch the DOM.
 *
 * Escaping is the substance of this file: `customer_name` is free text from
 * a retailer feed, and Chilean addresses/names routinely carry commas,
 * quotes, and accents. RFC 4180 rules: a field containing a comma, quote,
 * or line break is wrapped in double quotes, with embedded quotes doubled.
 */

import type { OrdersListRow } from '@/hooks/useOrdersList';

/** Excel on Windows — what these users have — mojibakes accented characters without this. */
const UTF8_BOM = '﻿';

const HEADER = ['PEDIDO', 'CLIENTE', 'ESTADO', 'PQT', 'RUTA', 'CONDUCTOR', 'SLA', 'ÚLTIMO EVENTO'];

const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (NEEDS_QUOTING.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function rowToLine(fields: Array<string | number | null | undefined>): string {
  return fields.map(escapeField).join(',');
}

/**
 * Columns match the order the order-list table shows them in:
 * PEDIDO, CLIENTE, ESTADO, PQT, RUTA, CONDUCTOR, SLA, ÚLTIMO EVENTO.
 */
export function ordersToCsv(rows: OrdersListRow[]): string {
  const lines = [
    rowToLine(HEADER),
    ...rows.map((row) =>
      rowToLine([
        row.order_number,
        row.customer_name,
        row.leading_status,
        row.package_count,
        row.route_label,
        row.driver_name,
        row.sla_status,
        row.last_event_label,
      ]),
    ),
  ];

  return UTF8_BOM + lines.join('\r\n');
}
