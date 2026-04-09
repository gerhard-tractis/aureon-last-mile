'use client';

import { useRef, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import type { ConversationSession, SessionStatus } from '@/lib/conversations/types';
import { useConversationMessages } from '@/hooks/conversations/useConversationMessages';
import { useSendReply } from '@/hooks/conversations/useSendReply';
import { useCloseSession } from '@/hooks/conversations/useCloseSession';
import { MessageBubble } from './MessageBubble';
import { ReplyBox } from './ReplyBox';

const STATUS_BADGE: Record<SessionStatus, string> = {
  escalated: 'bg-status-warning-bg text-status-warning border border-status-warning-border',
  active:    'bg-status-success-bg text-status-success border border-status-success-border',
  closed:    'bg-surface-raised text-text-muted border border-border',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  escalated: 'ESCALADO',
  active:    'ACTIVO',
  closed:    'CERRADO',
};

interface Props {
  session: ConversationSession;
  canReply: boolean;
}

export function ConversationThread({ session, canReply }: Props) {
  const { data: messages, isLoading } = useConversationMessages(session.id);
  const reply = useSendReply();
  const close = useCloseSession();
  const bottomRef = useRef<HTMLDivElement>(null);

  const showReplyBox = canReply && session.status === 'escalated';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
        <div>
          <h2 className="text-base font-semibold text-text">
            {session.customer_name ?? 'Sin nombre'}
          </h2>
          <p className="text-xs text-text-muted font-mono">
            #{session.order_number} · {session.customer_phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${STATUS_BADGE[session.status]}`}>
            {STATUS_LABELS[session.status]}
          </span>
          {showReplyBox && (
            <button
              onClick={() => close.mutate(session.id)}
              disabled={close.isPending}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-status-success-bg text-status-success border border-status-success-border hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              <CheckCircle className="w-3 h-3" /> Resolver
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && (
          <p className="text-center text-sm text-text-muted">Cargando mensajes...</p>
        )}
        {messages?.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      {showReplyBox && (
        <ReplyBox
          onSend={(body) => reply.mutate({ session_id: session.id, body })}
          isPending={reply.isPending}
          error={reply.error?.message ?? null}
        />
      )}
    </div>
  );
}
