'use client';

import type { SessionMessage } from '@/lib/conversations/types';

const WA_STATUS_ICONS: Record<string, string> = {
  sent:      '✓',
  delivered: '✓✓',
  read:      '✓✓',
  failed:    '✗',
};

interface MessageBubbleProps {
  message: SessionMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.role === 'system' || message.role === 'operator';
  const time = new Date(message.created_at).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit',
  });

  // Customer messages: neutral surface card
  // Agent (WISMO): accent (gold) bubble
  // Operator reply: info (blue) bubble — distinct from agent
  const bubbleClass =
    message.role === 'operator'
      ? 'bg-status-info-bg border border-status-info-border text-text'
      : message.role === 'system'
        ? 'bg-accent text-accent-foreground'
        : 'bg-surface border border-border text-text';

  const label =
    message.role === 'operator' ? 'Operador' : message.role === 'system' ? 'Agente' : null;

  return (
    <div
      data-testid={`bubble-${message.id}`}
      className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
    >
      <div className={`max-w-[65%] rounded-xl px-3 py-2 ${bubbleClass}`}>
        <p className="text-sm whitespace-pre-wrap">{message.body}</p>
        <div className={`flex items-center gap-1 mt-1 text-xs ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-text-muted">{time}</span>
          {label && <span className="text-text-muted">· {label}</span>}
          {isOutbound && message.wa_status && (
            <span className={
              message.wa_status === 'read'   ? 'text-status-info' :
              message.wa_status === 'failed' ? 'text-status-error' :
              'text-text-muted'
            }>
              {WA_STATUS_ICONS[message.wa_status] ?? ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
