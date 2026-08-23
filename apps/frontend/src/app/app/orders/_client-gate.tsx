'use client';

/**
 * OrdersClientGate — spec-65 Task 6.
 *
 * Mirrors DispatchClientGate/DistributionClientGate's shape (`permissions`
 * as the "claims loaded" signal — every real role carries at least one
 * permission, see lib/permissions.ts ROLE_DEFAULT_PERMISSIONS), but the
 * access rule itself matches the nav item's own `isVisible`
 * (navigation.ts): admin or operations_manager by role, OR the
 * customer_service permission. There is no ModuleKey — Pedidos is
 * deliberately ungated (spec-65 Decision 4).
 *
 * Deliberately NOT wired through a layout.tsx: `/app/orders/new` and
 * `/app/orders/import` are sibling routes under this same `orders/`
 * segment, gated to admin/operations_manager only (their own inline role
 * check). This gate's permission set is a superset of that (it additionally
 * admits customer_service), so a layout.tsx here would widen who can reach
 * those two routes — not narrow it. Importing this gate directly into
 * `page.tsx` keeps it scoped to the page it was written for.
 *
 * Known flash, repo-wide (controller review, round 4): `permissions.length
 * > 0` is a "claims loaded" proxy, not a real loading flag, so an
 * unauthorized user briefly sees `children` render before the redirect
 * fires. Checked `useOperatorId()` — it destructures only `operatorId`,
 * `role`, `permissions` and `userId` off `useGlobal()`, dropping the
 * `loading: boolean` that `GlobalContext` itself actually tracks
 * (`lib/context/GlobalContext.tsx`). This gate faithfully copies
 * `DispatchClientGate`/`DistributionClientGate`'s exact shape, which is
 * what this task was told to follow, so the flash is pre-existing and
 * repo-wide, not introduced here. Not fixed in this task: swapping in a
 * heuristic here (e.g. treating a still-null `operatorId` as "loading")
 * would diverge from the copied pattern and risks misreading a genuinely
 * unauthenticated/zero-permission state as "still loading," which renders
 * a blank page for a legitimate case instead of the flash. The real fix —
 * exposing `loading` through `useOperatorId()` and having every
 * `*ClientGate` render `null` on it — touches a shared hook and every
 * existing gate, which is outside this task's scope.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';

export default function OrdersClientGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role, permissions } = useOperatorId();

  const canAccess =
    role === 'admin' || role === 'operations_manager' || permissions.includes('customer_service');

  useEffect(() => {
    if (permissions.length > 0 && !canAccess) {
      router.push('/app/dashboard');
    }
  }, [permissions, canAccess, router]);

  if (permissions.length > 0 && !canAccess) {
    return null;
  }

  return <>{children}</>;
}
