'use client';

import { Search } from 'lucide-react';
import type { ConversationSession, ConversationFilters, SessionStatus } from '@/lib/conversations/types';
import { ConversationSessionCard } from './ConversationSessionCard';

const STATUS_OPTIONS: { value: SessionStatus; label: string }[] = [
  { value: 'escalated', label: 'Escalado' },
  { value: 'active', label: 'Activo' },
  { value: 'closed', label: 'Cerrado' },
];

interface Props {
  sessions: ConversationSession[];
  isLoading: boolean;
  selectedId: string | null;
  unreadIds: Set<string>;
  onSelect: (id: string) => void;
  filters: ConversationFilters;
  onFiltersChange: (f: ConversationFilters) => void;
}

export function ConversationList({
  sessions, isLoading, selectedId, unreadIds, onSelect, filters, onFiltersChange,
}: Props) {
  const toggleStatus = (status: SessionStatus) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onFiltersChange({ ...filters, statuses: next });
  };

  return (
    <div className="flex flex-col h-full w-[340px] min-w-[340px] border-r border-slate-800 bg-slate-950">
      {/* Search + filters */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Buscar cliente u orden..."
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleStatus(opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filters.statuses.includes(opt.value)
                  ? opt.value === 'escalated' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                    : opt.value === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                  : 'bg-slate-800 text-slate-500 border-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Date range */}
        <div className="flex gap-1.5">
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value || null })}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-slate-600"
          />
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value || null })}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-slate-600"
          />
          {(filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => onFiltersChange({ ...filters, dateFrom: null, dateTo: null })}
              className="text-xs text-slate-500 hover:text-slate-300 px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="text-center text-sm text-slate-500 py-8">Cargando...</p>}
        {!isLoading && sessions.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-8">No hay conversaciones</p>
        )}
        {sessions.map((s) => (
          <ConversationSessionCard
            key={s.id}
            session={s}
            isSelected={s.id === selectedId}
            isUnread={unreadIds.has(s.id)}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </div>
    </div>
  );
}
