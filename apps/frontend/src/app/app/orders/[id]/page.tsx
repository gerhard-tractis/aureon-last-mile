'use client';

/**
 * `/app/orders/[id]` — spec-65 Task 9, the order ficha page (mock `3b`).
 *
 * Gated directly with `OrdersClientGate`, the same component and the same
 * rule `/app/orders/page.tsx` uses (Task 6, ronda 1) — not via a
 * `layout.tsx`, which would also widen who reaches the sibling
 * `/app/orders/new` and `/app/orders/import` routes.
 *
 * `useSearchParams` (read inside `OrderFichaContent`, for the breadcrumb's
 * return path) requires a Suspense boundary or the production build fails
 * at prerender — see `/app/orders/page.tsx` for the same pattern.
 */

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import OrdersClientGate from '../_client-gate';
import { OrderFichaContent } from './_ficha-content';

export default function OrderFichaPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <OrdersClientGate>
      <Suspense>
        <OrderFichaContent orderId={id} />
      </Suspense>
    </OrdersClientGate>
  );
}
