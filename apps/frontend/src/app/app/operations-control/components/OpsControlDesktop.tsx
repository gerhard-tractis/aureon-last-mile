'use client';

import { useState } from 'react';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { useAtRiskOrders } from '@/hooks/ops-control/useAtRiskOrders';
import { useStageQuery } from '../lib/useStageQuery';
import { computeStageHealth } from '../lib/health';
import { STAGE_KEYS } from '../lib/labels.es';
import type { OpsSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import type { StageKey } from '../lib/labels.es';
import { Skeleton } from '@/components/ui/skeleton';

import { StageStrip } from './StageStrip';
import { AtRiskBanner } from './AtRiskBanner';
import { AtRiskTable } from './AtRiskTable';
import { PickupPanel } from './stage-panels/PickupPanel';
import { ReceptionPanel } from './stage-panels/ReceptionPanel';
import { ConsolidationPanel } from './stage-panels/ConsolidationPanel';
import { DocksPanel } from './stage-panels/DocksPanel';
import { DeliveryPanel } from './stage-panels/DeliveryPanel';
import { ReturnsPanel } from './stage-panels/ReturnsPanel';
import { ReversePlaceholderPanel } from './stage-panels/ReversePlaceholderPanel';

function getItemsForStage(key: StageKey, snapshot: OpsSnapshot): Record<string, unknown>[] {
  switch (key) {
    case 'pickup':        return snapshot.pickups as Record<string, unknown>[];
    case 'reception':     return snapshot.orders.filter((o) => o['stage'] === 'reception') as Record<string, unknown>[];
    case 'consolidation': return snapshot.orders.filter((o) => o['stage'] === 'consolidation') as Record<string, unknown>[];
    case 'docks':         return snapshot.routes.filter((r) => r['stage'] === 'docks') as Record<string, unknown>[];
    case 'delivery':      return snapshot.routes.filter((r) => r['stage'] === 'delivery' || r['status'] === 'active') as Record<string, unknown>[];
    case 'returns':       return snapshot.returns as Record<string, unknown>[];
    case 'reverse':       return [];
  }
}

interface OpsControlDesktopProps {
  operatorId: string;
}

export function OpsControlDesktop({ operatorId }: OpsControlDesktopProps) {
  const { snapshot, isLoading, lastSyncAt } = useOpsControlSnapshot(operatorId);
  const { activeStage, setStage } = useStageQuery();
  const [atRiskPage, setAtRiskPage] = useState(1);
  const { orders: atRiskOrders, total: atRiskTotal, pageCount: atRiskPageCount } =
    useAtRiskOrders(operatorId, new Date(), atRiskPage);

  if (isLoading && !snapshot) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const now = new Date();
  const stages = STAGE_KEYS.map((key) => {
    const items = snapshot ? getItemsForStage(key, snapshot) : [];
    const health = computeStageHealth(key, items, now);
    return { key, count: items.length, delta: health.delta, health: health.status };
  });

  const renderPanel = () => {
    if (!activeStage) {
      return (
        <AtRiskTable
          orders={atRiskOrders}
          total={atRiskTotal}
          page={atRiskPage}
          pageCount={Math.max(atRiskPageCount, 1)}
          onPageChange={setAtRiskPage}
        />
      );
    }
    const props = { operatorId, lastSyncAt };
    switch (activeStage) {
      case 'pickup':        return <PickupPanel {...props} />;
      case 'reception':     return <ReceptionPanel {...props} />;
      case 'consolidation': return <ConsolidationPanel {...props} />;
      case 'docks':         return <DocksPanel {...props} />;
      case 'delivery':      return <DeliveryPanel {...props} />;
      case 'returns':       return <ReturnsPanel {...props} />;
      case 'reverse':       return <ReversePlaceholderPanel {...props} />;
    }
  };

  return (
    <div className="space-y-4">
      {atRiskTotal > 0 && (
        <AtRiskBanner
          orders={atRiskOrders.slice(0, 3)}
          total={atRiskTotal}
          onViewAll={() => setStage(null)}
        />
      )}

      <StageStrip
        stages={stages}
        activeStage={activeStage}
        onStageChange={setStage}
      />

      {renderPanel()}
    </div>
  );
}
