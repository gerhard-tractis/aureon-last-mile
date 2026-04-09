'use client';

import { useRef, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import type { ConversationSession } from '@/lib/conversations/types';
import { useConversationMessages } from '@/hooks/conversations/useConversationMessages';
import { useSendReply } from '@/hooks/conversations/useSendReply';
import { useCloseSession } from '@/hooks/conversations/useCloseSession';
import { MessageBubble } from './MessageBubble';
import { ReplyBox } from './ReplyBox';

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {session.customer_name ?? 'Sin nombre'}
          </h2>
          <p className="text-xs text-slate-500">
            #{session.order_number} · {session.customer_phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${
            session.status === 'escalated' ? 'bg-amber-500/10 text-amber-500' :
            session.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' :
            'bg-slate-500/10 text-slate-500'
          }`}>
            {session.status === 'escalated' ? 'ESCALADO' : session.status === 'active' ? 'ACTIVO' : 'CERRADO'}
          </span>
          {showReplyBox && (
            <button
              onClick={() => close.mutate(session.id)}
              disabled={close.isPending}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3 h-3" /> Resolver
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && <p className="text-center text-sm text-slate-500">Cargando mensajes...</p>}
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
