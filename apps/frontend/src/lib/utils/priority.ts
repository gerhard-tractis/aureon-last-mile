import type { OperationsOrder } from '@/hooks/useOperationsOrders';
import type { OrderPriority } from '@/lib/types/pipeline';

export function computePriority(order: OperationsOrder): OrderPriority {
  if (!order.delivery_window_end) return 'ok';
  const windowEnd = new Date(order.delivery_window_end);
  if (windowEnd < new Date()) return 'late';
  const minsUntil = (windowEnd.getTime() - Date.now()) / 60000;
  if (minsUntil <= 45) return 'urgent';
  if (minsUntil <= 120) return 'alert';
  return 'ok';
}
