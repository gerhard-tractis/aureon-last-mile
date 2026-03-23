"use client";

import { useState } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PageShell } from '@/components/PageShell';
import { RealtimeStatusIndicator } from '@/components/operations-control/RealtimeStatusIndicator';
import { PipelineOverview } from '@/components/operations-control/PipelineOverview';
import { UrgentOrdersBanner } from '@/components/operations-control/UrgentOrdersBanner';
import { OrdersTable } from '@/components/operations-control/OrdersTable';
import { OrderDetailSheet } from '@/components/operations-control/OrderDetailSheet';
import { MobileOCC } from '@/components/operations-control/mobile/MobileOCC';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { setStatusFilter } = useOpsControlFilterStore();
  const isMobile = useIsMobile();

  // Start realtime subscription (no-op when operatorId is empty)
  useRealtimeOrders(operatorId ?? '');

  if (!operatorId) {
    return <div className="p-4 text-text-muted">Cargando...</div>;
  }

  if (isMobile) {
    return <MobileOCC operatorId={operatorId} />;
  }

  return (
    <PageShell
      title="Ops Control"
      breadcrumbs={[
        { label: 'Operaciones', href: '/app/dashboard' },
        { label: 'Ops Control' },
      ]}
      actions={
        <RealtimeStatusIndicator
          status={realtimeStatus}
        />
      }
    >
      {/* Urgent Orders Banner — above pipeline */}
      <UrgentOrdersBanner
        urgentCount={0}
        lateCount={0}
        onViewUrgent={() => setStatusFilter('urgent')}
      />

      {/* Pipeline Overview Strip */}
      <div className="mt-3">
        <PipelineOverview operatorId={operatorId} />
      </div>

      {/* Orders DataTable */}
      <div className="mt-4">
        <OrdersTable
          operatorId={operatorId}
          onOpenDetail={(orderId) => setSelectedOrderId(orderId)}
        />
      </div>

      {/* Order Detail Sheet (slide-out from right) */}
      <OrderDetailSheet
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </PageShell>
  );
}
