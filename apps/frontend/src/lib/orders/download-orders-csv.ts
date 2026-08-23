/**
 * spec-65 — shared CSV-blob-download helper.
 *
 * `_page-helpers.downloadCurrentPageCsv` (Task 6, current page) and
 * `OrdersBulkBar`'s own download (Task 5, the selection) used to carry
 * byte-identical Blob/anchor-click download logic, differing only in the
 * filename, each defended by a comment saying so. Extracted here (final
 * review round) — the filename is the only thing that varies, so it's the
 * only thing left as a parameter.
 */

import { ordersToCsv } from './orders-csv';
import type { OrdersListRow } from '@/hooks/useOrdersList';

export function downloadOrdersCsv(rows: OrdersListRow[], filename: string) {
  const csv = ordersToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
