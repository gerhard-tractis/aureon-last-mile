"use client";

import { useState } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';
import { PipelineOverview } from '@/components/operations-control/PipelineOverview';
import { UrgentOrdersBanner } from '@/components/operations-control/UrgentOrdersBanner';
import { OrdersFilterToolbar } from '@/components/operations-control/OrdersFilterToolbar';
import { OrdersTable } from '@/components/operations-control/OrdersTable';
import { OrderDetailModal } from '@/components/operations-control/OrderDetailModal';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { setStatusFilter } = useOpsControlFilterStore();

  // Start realtime subscription (no-op when operatorId is empty)
  useRealtimeOrders(operatorId ?? '');

  if (!operatorId) {
    return <div className="p-4 text-gray-500">Cargando...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Ops Control</h1>
      </div>

      {/* Pipeline Overview */}
      <PipelineOverview
        operatorId={operatorId}
        realtimeStatus={realtimeStatus}
        lastFetchedAt={null}
      />

      {/* Urgent Orders Banner — counts computed in future iteration */}
      <UrgentOrdersBanner
        urgentCount={0}
        lateCount={0}
        onViewUrgent={() => setStatusFilter('urgent')}
      />

      {/* Filter Toolbar */}
      <OrdersFilterToolbar />

      {/* Orders Table */}
      <OrdersTable
        operatorId={operatorId}
        onOpenDetail={(orderId) => setSelectedOrderId(orderId)}
      />

      {/* Order Detail Modal */}
      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
}
