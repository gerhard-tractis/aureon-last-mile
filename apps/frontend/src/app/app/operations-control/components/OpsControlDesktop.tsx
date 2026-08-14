'use client';

import { useState } from 'react';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { useAtRiskOrders } from '@/hooks/ops-control/useAtRiskOrders';
import { useDayPromise } from '@/hooks/ops-control/useDayPromise';
import { useActiveRoutes } from '@/hooks/useActiveRoutes';
import { useStageQuery } from '../lib/useStageQuery';
import { computeStageHealth } from '../lib/health';
import { STAGE_KEYS } from '../lib/labels.es';
import type { OpsSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import type { StageKey } from '../lib/labels.es';
import { Skeleton } from '@/components/ui/skeleton';

import { StageRail } from './StageRail';
import { AtRiskPanel } from './AtRiskPanel';
import { PromiseCard } from './PromiseCard';
import { FleetCard } from './FleetCard';
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
    case 'docks':         return [
      ...snapshot.orders.filter((o) => o['stage'] === 'docks'),
      ...snapshot.routes.filter((r) => r['stage'] === 'docks'),
    ] as Record<string, unknown>[];
    case 'delivery':      return snapshot.routes.filter((r) => r['stage'] === 'delivery' || r['status'] === 'active') as Record<string, unknown>[];
    case 'returns':       return snapshot.returns as Record<string, unknown>[];
    case 'reverse':       return [];
  }
}

interface OpsControlDesktopProps {
  operatorId: string;
  onSelectOrder?: (orderId: string) => void;
}

export function OpsControlDesktop({ operatorId, onSelectOrder }: OpsControlDesktopProps) {
  const { snapshot, isLoading, lastSyncAt } = useOpsControlSnapshot(operatorId);
  const { activeStage, setStage } = useStageQuery();
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);

  const { orders: atRiskOrders, total: atRiskTotal, pageCount: atRiskPageCount } =
    useAtRiskOrders(operatorId, new Date(), atRiskPage);
  const promise = useDayPromise(operatorId);
  const { data: activeRoutes, isLoading: routesLoading } = useActiveRoutes(operatorId);

  if (isLoading && !snapshot) {
    // Geometry matches the loaded layout so the page does not reflow.
    return (
      <div className="flex flex-col gap-[18px]">
        <Skeleton className="h-9 w-64 rounded" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-[10px]" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_336px]">
          <Skeleton className="h-[420px] rounded-[10px]" />
          <Skeleton className="hidden h-[420px] rounded-[10px] xl:block" />
        </div>
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
        <AtRiskPanel
          orders={atRiskOrders}
          total={atRiskTotal}
          page={atRiskPage}
          pageCount={Math.max(atRiskPageCount, 1)}
          onPageChange={setAtRiskPage}
          reasonFilter={reasonFilter}
          onReasonFilterChange={setReasonFilter}
          onSelectOrder={onSelectOrder}
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
    <div className="flex flex-col gap-[18px]">
      <StageRail stages={stages} activeStage={activeStage} onStageChange={setStage} />

      {/* The action queue and the day's context sit side by side above 1280px
          and stack below it, per the handoff's responsive rule. */}
      <div className="grid min-h-0 gap-4 xl:grid-cols-[1fr_336px]">
        <div className="min-w-0">{renderPanel()}</div>

        <aside className="flex min-h-0 flex-col gap-4">
          <PromiseCard promise={promise} />
          <FleetCard routes={activeRoutes ?? []} isLoading={routesLoading} />
        </aside>
      </div>
    </div>
  );
}
