"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { OrderTable, computeOrderKpis } from './OrderTable';
import type { StagePanelProps } from './PickupPanel';

export function DocksPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows } = useStageBreakdown('docks', operatorId, 1);

  return (
    <StagePanel
      title="Andenes"
      subtitle="Órdenes en carga y listas para despacho"
      deepLink="/app/dispatch"
      deepLinkLabel="Abrir Despacho"
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
