'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ScanLine, WifiOff } from 'lucide-react';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { EmptyState } from '@/components/EmptyState';
import { MoveTaskList } from '@/components/distribution/MoveTaskList';
import { Skeleton } from '@/components/ui/skeleton';
import { useMoveTaskSnapshot } from '@/hooks/distribution/useMoveTaskSnapshot';
import { useOperatorId } from '@/hooks/useOperatorId';

/**
 * spec-71 phase 5 — "faltan por mover a posición", the mobile move-task
 * picker.
 *
 * Reached from Distribución's PROCESOS DE LA NAVE (`DistributionMobileView`)
 * and from `/app/distribution` generally, same shell as `/pendientes`:
 * `DistributionMobileHeader`, a fixed 56px footer action bar, content
 * padded to clear it. Pure presentation over `get_move_task_snapshot` — no
 * write path here; the actual staging scan already exists at
 * `/app/distribution/quicksort` (mode='stage', spec-71 phase 3), which the
 * footer links to.
 *
 * Desktop is out of scope by design (see spec-71's phase 5 Decision): this
 * is the mobile picker for the operator doing the andén->position walk, not
 * the wave-level supervisor view (staging progress, conflicts, unassigned
 * routes at a glance across the floor) — that is deliberately deferred to
 * its own spec.
 *
 * Review fix (item 5) — same failure mode `andenes/page.tsx` was already
 * fixed for: `isError` was discarded, so a failed RPC rendered the
 * confident empty state "Nada por mover" instead of a distinct error
 * screen, and `useOperatorId()` returning `null` on the first frame made
 * the query `enabled: false`, which reports `isLoading: false` too — the
 * pre-auth frame then rendered that same false-empty state rather than a
 * loading one. `isError` is checked first; loading is then gated on
 * `!operatorId || !snapshot` itself, not on the query's own `isLoading`.
 */
export default function MoveTaskPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { snapshot, isError } = useMoveTaskSnapshot(operatorId);

  const goBack = () => router.push('/app/distribution');

  if (isError) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Mover a posición" onBack={goBack} />
        <EmptyState
          icon={WifiOff}
          title="No pudimos cargar el listado"
          description="Revisa tu conexión e intenta de nuevo. Los paquetes por mover no cambiaron — es la pantalla la que no pudo leerlos."
        />
      </div>
    );
  }

  if (!operatorId || !snapshot) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Mover a posición" onBack={goBack} />
        <div data-testid="move-task-page-skeleton" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const routes = snapshot.routes;
  const unassignedRoutes = snapshot.unassigned_routes;
  const totalRemaining = routes.reduce((n, r) => n + r.remaining_packages, 0);

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title="Mover a posición"
        subtitle={
          /* Blocked work is still work. Saying "Nada por mover" while the
             screen lists routes with packages stuck behind a missing position
             is how an operator learns to stop believing this screen. */
          totalRemaining > 0
            ? `${totalRemaining} ${totalRemaining === 1 ? 'paquete' : 'paquetes'} por mover`
            : unassignedRoutes.length > 0
              ? 'Sin posición asignada — nada que mover aún'
              : 'Nada por mover'
        }
        onBack={goBack}
      />

      <MoveTaskList routes={routes} unassignedRoutes={unassignedRoutes} />

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <span className="flex-1 truncate font-mono text-[12.5px] text-text-secondary">
          {totalRemaining} {totalRemaining === 1 ? 'paquete' : 'paquetes'} por mover
        </span>
        <Link
          href="/app/distribution/quicksort"
          className="flex h-[56px] flex-none items-center justify-center gap-2 rounded-xl bg-accent-light px-6 text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
        >
          <ScanLine className="h-5 w-5" />
          Escanear
        </Link>
      </div>
    </div>
  );
}
