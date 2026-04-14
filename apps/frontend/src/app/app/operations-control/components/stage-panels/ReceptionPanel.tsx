"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { OrderTable, computeOrderKpis } from './OrderTable';
import type { StagePanelProps } from './PickupPanel';

export function ReceptionPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows } = useStageBreakdown('reception', operatorId, 1);

  return (
    <StagePanel
      title="Recepción"
      subtitle="Órdenes pendientes de recepción en hub"
      deepLink="/app/reception"
      deepLinkLabel="Abrir Recepción"
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
