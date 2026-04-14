"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { OrderTable, computeOrderKpis } from './OrderTable';
import type { StagePanelProps } from './PickupPanel';

export function ReturnsPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows } = useStageBreakdown('returns', operatorId, 1);

  return (
    <StagePanel
      title="Reingresos"
      subtitle="Órdenes devueltas pendientes de reingreso"
      deepLink={null}
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
