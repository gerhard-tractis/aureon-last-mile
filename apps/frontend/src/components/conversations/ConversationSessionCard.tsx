'use client';

import type { ConversationSession, SessionStatus } from '@/lib/conversations/types';

const STATUS_COLORS: Record<SessionStatus, string> = {
  escalated: 'bg-amber-500/10 text-amber-500',
  active: 'bg-emerald-500/10 text-emerald-500',
  closed: 'bg-slate-500/10 text-slate-500',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  escalated: 'ESCALADO',
  active: 'ACTIVO',
  closed: 'CERRADO',
};

const BORDER_COLORS: Record<SessionStatus, string> = {
  escalated: 'border-l-amber-500',
  active: 'border-l-emerald-500',
  closed: 'border-l-slate-600',
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
        isSelected ? 'bg-slate-800' : 'hover:bg-slate-800/50'
      } transition-colors`}
    >
      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold text-slate-100 truncate">{session.customer_name ?? 'Sin nombre'}</span>
          <span className="text-xs text-slate-500 shrink-0 ml-2">{time}</span>
        </div>
        <div className="text-xs text-slate-400 truncate">#{session.order_number}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLORS[session.status]}`}>
            {STATUS_LABELS[session.status]}
          </span>
          {isUnread && (
            <span data-testid="unread-dot" className="w-2 h-2 rounded-full bg-sky-500" />
          )}
        </div>
      </div>
    </button>
  );
}
