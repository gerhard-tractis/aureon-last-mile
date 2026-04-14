"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { OrderTable, computeOrderKpis } from './OrderTable';
import type { StagePanelProps } from './PickupPanel';

export function DeliveryPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows } = useStageBreakdown('delivery', operatorId, 1);

  return (
    <StagePanel
      title="Reparto"
      subtitle="Órdenes en ruta de entrega"
      deepLink="/app/dispatch?view=routes"
      deepLinkLabel="Abrir Rutas"
      kpis={computeOrderKpis(rows)}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      lastSyncAt={lastSyncAt}
    >
      <OrderTable orders={rows} />
    </StagePanel>
  );
}
