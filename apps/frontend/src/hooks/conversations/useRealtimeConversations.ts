// src/hooks/conversations/useRealtimeConversations.ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useConversationStore } from '@/lib/stores/conversationStore';

/**
 * Subscribes to Realtime changes on customer_sessions and customer_session_messages
 * for the given operator. Invalidates TanStack Query caches on change.
 */
export function useRealtimeConversations(operatorId: string | null) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();

    const channel = supabase
      .channel(`operator:${operatorId}:conversations`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'customer_sessions',
        filter: `operator_id=eq.${operatorId}`,
      }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] });
        }, 1000);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_session_messages',
        filter: `operator_id=eq.${operatorId}`,
      }, (payload) => {
        const sessionId = (payload.new as { session_id?: string }).session_id;
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['conversations', 'messages', sessionId] });
          useConversationStore.getState().markUnread(sessionId);
        }
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [operatorId, queryClient]);
}
