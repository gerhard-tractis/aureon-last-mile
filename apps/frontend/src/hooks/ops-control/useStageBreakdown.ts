import { useMemo } from 'react';
import { useOpsControlSnapshot } from './useOpsControlSnapshot';
import {
  computeStageHealth,
  type StageHealthResult,
} from '@/app/app/operations-control/lib/health';

export type StageKey =
  | 'pickup'
  | 'reception'
  | 'consolidation'
  | 'docks'
  | 'delivery'
  | 'returns'
  | 'reverse';

export type StageBreakdownResult = {
  rows: Record<string, unknown>[];
  total: number;
  pageCount: number;
  stageHealth: StageHealthResult;
};

const PAGE_SIZE = 25;

const NEUTRAL_HEALTH: StageHealthResult = {
  status: 'neutral',
  delta: '—',
  reasonsByOrder: new Map(),
};

function getItems(
  stageKey: StageKey,
  snapshot: {
    pickups: Record<string, unknown>[];
    orders: Record<string, unknown>[];
    routes: Record<string, unknown>[];
    returns: Record<string, unknown>[];
  }
): Record<string, unknown>[] {
  switch (stageKey) {
    case 'pickup':
      return snapshot.pickups;
    case 'reception':
      return snapshot.orders.filter((o) => o['stage'] === 'reception');
    case 'consolidation':
      return snapshot.orders.filter((o) => o['stage'] === 'consolidation');
    case 'docks':
      return snapshot.orders.filter((o) => o['stage'] === 'docks');
    case 'delivery':
      return snapshot.routes.filter(
        (r) => r['stage'] === 'delivery' || r['status'] === 'active'
      );
    case 'returns':
      return snapshot.returns;
    case 'reverse':
      return [];
  }
}

function sortItems(
  stageKey: StageKey,
  items: Record<string, unknown>[]
): Record<string, unknown>[] {
  const sorted = [...items];
  switch (stageKey) {
    case 'pickup':
      return sorted.sort(
        (a, b) => ((b['overdue_minutes'] as number) ?? 0) - ((a['overdue_minutes'] as number) ?? 0)
      );
    case 'reception':
      return sorted.sort(
        (a, b) =>
          ((b['dwell_minutes'] as number) ?? 0) - ((a['dwell_minutes'] as number) ?? 0)
      );
    case 'consolidation':
    case 'returns':
      return sorted.sort(
        (a, b) => ((b['age_minutes'] as number) ?? 0) - ((a['age_minutes'] as number) ?? 0)
      );
    case 'docks':
      return sorted.sort(
        (a, b) =>
          ((b['idle_minutes'] as number) ?? 0) - ((a['idle_minutes'] as number) ?? 0)
      );
    case 'delivery':
      return sorted.sort(
        (a, b) =>
          ((b['behind_plan_minutes'] as number) ?? 0) -
          ((a['behind_plan_minutes'] as number) ?? 0)
      );
    case 'reverse':
      return sorted;
  }
}

export function useStageBreakdown(
  stageKey: StageKey,
  operatorId: string | null,
  page: number
): StageBreakdownResult {
  const { snapshot } = useOpsControlSnapshot(operatorId);

  return useMemo(() => {
    if (!snapshot) {
      return { rows: [], total: 0, pageCount: 0, stageHealth: NEUTRAL_HEALTH };
    }

    const now = new Date();
    const items = getItems(stageKey, snapshot);
    const sorted = sortItems(stageKey, items);
    const total = sorted.length;
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const start = (page - 1) * PAGE_SIZE;
    const rows = sorted.slice(start, start + PAGE_SIZE);
    const stageHealth = computeStageHealth(stageKey, items, now);

    return { rows, total, pageCount, stageHealth };
  }, [snapshot, stageKey, page]);
}
