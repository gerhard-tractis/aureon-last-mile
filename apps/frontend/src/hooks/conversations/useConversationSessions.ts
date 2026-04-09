// src/hooks/conversations/useConversationSessions.ts
import { useQuery } from '@tanstack/react-query';
import { fetchSessions } from '@/lib/conversations/queries';
import type { ConversationFilters } from '@/lib/conversations/types';

export function useConversationSessions(
  operatorId: string | null,
  filters: ConversationFilters,
) {
  return useQuery({
    queryKey: ['conversations', 'sessions', operatorId, filters],
    queryFn: () => fetchSessions(operatorId!, filters),
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
