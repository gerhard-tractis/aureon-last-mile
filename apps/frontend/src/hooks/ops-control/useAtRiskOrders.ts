import { useMemo } from 'react';
import { useOpsControlSnapshot } from './useOpsControlSnapshot';
import { classifyRisk } from '@/app/app/operations-control/lib/sla';

export type AtRiskOrder = {
  id: string;
  status: 'late' | 'at_risk';
  minutesRemaining: number;
  label: string;
  stage: string;
  retailer: string;
  customer: string;
  address: string;
  reasonFlag: string;
};

export type AtRiskOrdersResult = {
  orders: AtRiskOrder[];
  total: number;
  pageCount: number;
};

const PAGE_SIZE = 25;

export function useAtRiskOrders(
  operatorId: string | null,
  now: Date = new Date(),
  page = 1
): AtRiskOrdersResult {
  const { snapshot } = useOpsControlSnapshot(operatorId);

  return useMemo(() => {
    if (!snapshot) {
      return { orders: [], total: 0, pageCount: 0 };
    }

    const atRisk: AtRiskOrder[] = [];

    for (const order of snapshot.orders) {
      const risk = classifyRisk(order as Parameters<typeof classifyRisk>[0], now);
      if (risk.status !== 'late' && risk.status !== 'at_risk') continue;

      atRisk.push({
        id: order['id'] as string,
        status: risk.status,
        minutesRemaining: risk.minutesRemaining,
        label: risk.label,
        stage: (order['stage'] as string) ?? '',
        retailer: (order['retailer'] as string) ?? '',
        customer: (order['customer_name'] as string) ?? '',
        address: (order['address'] as string) ?? '',
        reasonFlag: (order['reason_flag'] as string) ?? '',
      });
    }

    // Sort: late first, then at_risk; within each group, smallest minutesRemaining first
    atRisk.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'late' ? -1 : 1;
      }
      return a.minutesRemaining - b.minutesRemaining;
    });

    const total = atRisk.length;
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const start = (page - 1) * PAGE_SIZE;
    const orders = atRisk.slice(start, start + PAGE_SIZE);

    return { orders, total, pageCount };
  }, [snapshot, now, page]);
}
