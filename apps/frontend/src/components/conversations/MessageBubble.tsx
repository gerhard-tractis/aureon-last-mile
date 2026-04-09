'use client';

import type { SessionMessage } from '@/lib/conversations/types';

const WA_STATUS_ICONS: Record<string, string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '✗',
};

interface MessageBubbleProps {
  message: SessionMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.role === 'system' || message.role === 'operator';
  const time = new Date(message.created_at).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit',
  });

  const bubbleColor =
    message.role === 'operator'
      ? 'bg-purple-600'
      : message.role === 'system'
        ? 'bg-sky-600'
        : 'bg-slate-800';

  const label =
    message.role === 'operator' ? 'Operador' : message.role === 'system' ? 'Agente' : null;

  return (
    <div
      data-testid={`bubble-${message.id}`}
      className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
    >
      <div className={`max-w-[65%] rounded-xl px-3 py-2 ${bubbleColor}`}>
        <p className="text-sm text-white whitespace-pre-wrap">{message.body}</p>
        <div className={`flex items-center gap-1 mt-1 text-xs ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-slate-300">{time}</span>
          {label && <span className="text-slate-300">· {label}</span>}
          {isOutbound && message.wa_status && (
            <span className={message.wa_status === 'read' ? 'text-sky-400' : message.wa_status === 'failed' ? 'text-red-400' : 'text-slate-400'}>
              {WA_STATUS_ICONS[message.wa_status] ?? ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
