// src/hooks/conversations/useSendReply.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ReplyPayload {
  session_id: string;
  body: string;
}

export function useSendReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ReplyPayload) => {
      const res = await fetch('/api/conversations/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reply failed');
      return data as { message_id: string; created_at: string };
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'messages', vars.session_id] });
    },
  });
}
