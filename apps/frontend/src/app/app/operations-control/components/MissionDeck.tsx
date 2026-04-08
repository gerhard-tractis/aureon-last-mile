'use client';

import { useState } from 'react';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { useAtRiskOrders } from '@/hooks/ops-control/useAtRiskOrders';
import { useStageQuery } from '../lib/useStageQuery';
import { computeStageHealth } from '../lib/health';
import { STAGE_KEYS } from '../lib/labels.es';
import { TopBar } from './TopBar';
import { AtRiskBar } from './AtRiskBar';
import { AtRiskList } from './AtRiskList';
import { TelemetryStrip } from './TelemetryStrip';
import { PickupPanel } from './stage-panels/PickupPanel';
import { ReceptionPanel } from './stage-panels/ReceptionPanel';
import { ConsolidationPanel } from './stage-panels/ConsolidationPanel';
import { DocksPanel } from './stage-panels/DocksPanel';
import { DeliveryPanel } from './stage-panels/DeliveryPanel';
import { ReturnsPanel } from './stage-panels/ReturnsPanel';
import { ReversePlaceholderPanel } from './stage-panels/ReversePlaceholderPanel';
import type { OpsSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import type { StageKey } from '../lib/labels.es';

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

export interface MissionDeckProps {
  operatorId: string | null;
}

export function MissionDeck({ operatorId }: MissionDeckProps) {
  const { snapshot, isLoading, lastSyncAt } = useOpsControlSnapshot(operatorId);
  const { activeStage, setStage } = useStageQuery();
  const [atRiskPage, setAtRiskPage] = useState(1);
  const { orders: atRiskOrders, total: atRiskTotal, pageCount: atRiskPageCount } =
    useAtRiskOrders(operatorId, new Date(), atRiskPage);

  if (!operatorId) return <div>Sin operador</div>;

  if (isLoading && !snapshot) {
    return (
      <div style={{ background: 'var(--md-bg)', minHeight: '100vh', color: 'var(--md-text)' }}>
        <TopBar warehouseCode="SCL-01" />
        <div style={{ padding: '24px', color: 'var(--md-dim)' }}>Cargando...</div>
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
        <AtRiskList
          orders={atRiskOrders}
          total={atRiskTotal}
          page={atRiskPage}
          pageCount={Math.max(atRiskPageCount, 1)}
          onPageChange={setAtRiskPage}
        />
      );
    }
    switch (activeStage) {
      case 'pickup':        return <PickupPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'reception':     return <ReceptionPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'consolidation': return <ConsolidationPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'docks':         return <DocksPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'delivery':      return <DeliveryPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'returns':       return <ReturnsPanel operatorId={operatorId} lastSyncAt={lastSyncAt} />;
      case 'reverse':       return <ReversePlaceholderPanel />;
    }
  };

  return (
    <div style={{ background: 'var(--md-bg)', minHeight: '100vh', color: 'var(--md-text)' }}>
      <TopBar warehouseCode="SCL-01" />
      <AtRiskBar
        orders={atRiskOrders.slice(0, 3)}
        total={atRiskTotal}
        onSelect={() => setStage(null)}
      />
      <TelemetryStrip
        stages={stages}
        activeStage={activeStage}
        onStageChange={setStage}
      />
      <div style={{ padding: '16px' }}>{renderPanel()}</div>
    </div>
  );
}
