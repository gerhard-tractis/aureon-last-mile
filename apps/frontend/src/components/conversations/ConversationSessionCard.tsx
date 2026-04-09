'use client';

import type { ConversationSession, SessionStatus } from '@/lib/conversations/types';

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

const BORDER_COLORS: Record<SessionStatus, string> = {
  escalated: 'border-l-status-warning',
  active:    'border-l-status-success',
  closed:    'border-l-border',
};

interface Props {
  session: ConversationSession;
  isSelected: boolean;
  isUnread: boolean;
  onClick: () => void;
}

export function ConversationSessionCard({ session, isSelected, isUnread, onClick }: Props) {
  const initials = (session.customer_name ?? '??')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const time = new Date(session.updated_at).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex gap-3 items-start px-3 py-3 border-l-4 ${BORDER_COLORS[session.status]} ${
        isSelected ? 'bg-surface-raised' : 'hover:bg-surface'
      } transition-colors`}
    >
      <div className="w-9 h-9 rounded-full bg-surface-raised border border-border flex items-center justify-center text-sm font-bold text-text-secondary shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold text-text truncate">
            {session.customer_name ?? 'Sin nombre'}
          </span>
          <span className="text-xs text-text-muted shrink-0 ml-2">{time}</span>
        </div>
        <div className="text-xs text-text-muted truncate font-mono">#{session.order_number}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[session.status]}`}>
            {STATUS_LABELS[session.status]}
          </span>
          {isUnread && (
            <span data-testid="unread-dot" className="w-2 h-2 rounded-full bg-status-info" />
          )}
        </div>
      </div>
    </button>
  );
}
