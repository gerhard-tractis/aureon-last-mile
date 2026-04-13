'use client';

import { Suspense, useState, useCallback } from 'react';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useConversationSessions } from '@/hooks/conversations/useConversationSessions';
import { useRealtimeConversations } from '@/hooks/conversations/useRealtimeConversations';
import { useConversationStore } from '@/lib/stores/conversationStore';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { MessageSquare } from 'lucide-react';
import type { ConversationFilters } from '@/lib/conversations/types';

function ConversationsContent() {
  const { operatorId, role, permissions } = useGlobal();
  const { selectedSessionId, selectSession, unreadSessionIds } = useConversationStore();

  const [filters, setFilters] = useState<ConversationFilters>({
    statuses: [], dateFrom: null, dateTo: null, search: '',
  });

  const { data: sessions, isLoading } = useConversationSessions(operatorId, filters);
  useRealtimeConversations(operatorId);

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';
  const canReply = isAdminOrManager || permissions.includes('customer_service');

  const selectedSession = sessions?.find((s) => s.id === selectedSessionId) ?? null;

  const handleSelect = useCallback((id: string) => selectSession(id), [selectSession]);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <ConversationList
        sessions={sessions ?? []}
        isLoading={isLoading}
        selectedId={selectedSessionId}
        unreadIds={unreadSessionIds}
        onSelect={handleSelect}
        filters={filters}
        onFiltersChange={setFilters}
      />
      <div className="flex-1 bg-background">
        {selectedSession ? (
          <ConversationThread session={selectedSession} canReply={canReply} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={null}>
      <ConversationsContent />
    </Suspense>
  );
}
