/**
 * Order status update logic for terminal dispatch events.
 * Extracted from beetrack-webhook edge function for testability.
 *
 * Status mapping:
 *   dispatch delivered (2) → order entregado
 *   dispatch failed (3)    → order cancelado
 *   dispatch partial (4)   → order cancelado
 *   dispatch pending (1)   → no order update
 */

export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface OrderStatusUpdate {
  orderStatus: 'entregado' | 'cancelado';
  statusDetail: string;
}

/**
 * Determine the order status update for a terminal dispatch event.
 * Returns null if no order update should occur (pending status or missing orderId).
 */
export function getOrderStatusUpdate(
  status: DispatchStatus,
  dispatchId: number,
  substatus?: string | null,
): OrderStatusUpdate | null {
  if (status === 'pending') return null;

  const orderStatus = status === 'delivered' ? 'entregado' : 'cancelado';

  let statusDetail: string;
  if (status === 'delivered') {
    statusDetail = `Delivered via DispatchTrack dispatch #${dispatchId}`;
  } else if (status === 'partial') {
    statusDetail = `Partial delivery via DispatchTrack dispatch #${dispatchId}${substatus ? ` — ${substatus}` : ''}`;
  } else {
    statusDetail = substatus || `Failed via DispatchTrack dispatch #${dispatchId}`;
  }

  return { orderStatus, statusDetail } as const;
}

/**
 * Check if an order status update should be skipped.
 * Delivered orders should never be downgraded.
 */
export function shouldSkipOrderUpdate(
  currentOrderStatus: string,
  _newStatus: 'entregado' | 'cancelado',
): boolean {
  // Never downgrade from entregado
  if (currentOrderStatus === 'entregado') return true;
  return false;
}
