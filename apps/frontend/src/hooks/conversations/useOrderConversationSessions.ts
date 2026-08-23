// src/hooks/conversations/useOrderConversationSessions.ts
import { useQuery } from '@tanstack/react-query';
import { fetchSessionsForOrder } from '@/lib/conversations/queries';

/**
 * spec-65 Task 8 — sessions for one order, for `1f`'s Conversación tab.
 * `useConversationSessions` (the conversations list screen's hook) fetches
 * across all of an operator's orders; this needs exactly one order's
 * sessions, so it's its own hook over the new `fetchSessionsForOrder` query
 * rather than a filter bolted onto the list-screen hook's shape.
 */
export function useOrderConversationSessions(operatorId: string | null, orderId: string | null) {
  return useQuery({
    queryKey: ['conversations', 'sessions', 'order', operatorId, orderId],
    queryFn: () => fetchSessionsForOrder(operatorId!, orderId!),
    enabled: !!operatorId && !!orderId,
    staleTime: 30_000,
  });
}
