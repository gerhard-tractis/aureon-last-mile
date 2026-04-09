// src/hooks/conversations/useConversationMessages.ts
import { useQuery } from '@tanstack/react-query';
import { fetchMessages } from '@/lib/conversations/queries';

export function useConversationMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['conversations', 'messages', sessionId],
    queryFn: () => fetchMessages(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
  });
}
