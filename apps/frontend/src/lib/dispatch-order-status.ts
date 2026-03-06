/**
 * Order status update logic for terminal dispatch events.
 * Extracted from beetrack-webhook edge function for testability.
 *
 * Status mapping:
 *   dispatch delivered (2) → order delivered
 *   dispatch failed (3)    → order failed
 *   dispatch partial (4)   → order failed
 *   dispatch pending (1)   → no order update
 */

export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface OrderStatusUpdate {
  orderStatus: 'delivered' | 'failed';
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

  const orderStatus = status === 'delivered' ? 'delivered' : 'failed';

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
  _newStatus: 'delivered' | 'failed',
): boolean {
  // Never downgrade from delivered
  if (currentOrderStatus === 'delivered') return true;
  return false;
}
