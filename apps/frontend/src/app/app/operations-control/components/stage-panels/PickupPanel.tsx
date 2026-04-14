"use client";

import { StagePanel } from '../StagePanel';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { OrderTable, computeOrderKpis } from './OrderTable';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

export function PickupPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { snapshot } = useOpsControlSnapshot(operatorId);
  const orders = (snapshot?.pickups ?? []) as Record<string, unknown>[];

  return (
    <StagePanel
      title="Recogida"
      subtitle="Órdenes en tránsito hacia recepción"
      deepLink="/app/pickup"
      deepLinkLabel="Abrir Recogida"
      kpis={computeOrderKpis(orders)}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      lastSyncAt={lastSyncAt}
    >
      <OrderTable orders={orders} />
    </StagePanel>
  );
}
