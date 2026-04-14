"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { OrderTable, computeOrderKpis } from './OrderTable';
import type { StagePanelProps } from './PickupPanel';

export function ConsolidationPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows } = useStageBreakdown('consolidation', operatorId, 1);

  return (
    <StagePanel
      title="Consolidación"
      subtitle="Órdenes en bodega pendientes de despacho"
      deepLink="/app/distribution"
      deepLinkLabel="Abrir Distribución"
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
