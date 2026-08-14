'use client';

import { Suspense, useState } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { RealtimeStatusIndicator } from '@/components/operations-control/RealtimeStatusIndicator';
import { OrderInspector } from '@/components/inspector/OrderInspector';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { useDayPromise } from '@/hooks/ops-control/useDayPromise';
import { OpsControlDesktop } from './components/OpsControlDesktop';
import { TowerHeader } from './components/TowerHeader';

/**
 * spec-54 phase 4 — the tower no longer uses PageShell.
 *
 * PageShell renders a title and a rule; the mock's title row carries a live
 * subtitle and a primary action alongside the heading, and the content below
 * is a full-height two-column grid rather than a stack. Wrapping that in
 * PageShell meant fighting it, so the page owns its own header.
 */
export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();
  const promise = useDayPromise(operatorId);
  const [inspectorOrderId, setInspectorOrderId] = useState<string | null>(null);

  if (!operatorId) {
    return <div className="p-6 text-text-muted">Cargando…</div>;
  }

  return (
    <div className="flex flex-col gap-[18px] px-6 py-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <TowerHeader promise={promise} />
        </div>
        <RealtimeStatusIndicator status={realtimeStatus} />
      </div>

      {/* Suspense required: OpsControlDesktop uses useSearchParams via useStageQuery */}
      <Suspense fallback={null}>
        <OpsControlDesktop operatorId={operatorId} onSelectOrder={setInspectorOrderId} />
      </Suspense>

      <OrderInspector orderId={inspectorOrderId} onClose={() => setInspectorOrderId(null)} />
    </div>
  );
}
