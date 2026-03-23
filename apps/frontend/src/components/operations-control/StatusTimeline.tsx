'use client';

/**
 * StatusTimeline
 * Visual timeline of order status changes from audit logs.
 */

import type { AuditEntry } from '@/hooks/useOrderDetail';

interface StatusTimelineProps {
  auditLogs: AuditEntry[];
}

function formatTimestamp(isoString: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

export function StatusTimeline({ auditLogs }: StatusTimelineProps) {
  if (auditLogs.length === 0) {
    return (
      <p className="text-sm text-text-muted py-2">Sin historial de cambios</p>
    );
  }

  const sorted = [...auditLogs].sort((a, b) => {
    if (!a.timestamp) return -1;
    if (!b.timestamp) return 1;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  return (
    <ol className="relative border-l-2 border-[var(--color-accent)]">
      {sorted.map((entry) => (
        <li key={entry.id} className="mb-4 ml-4">
          <div className="absolute w-3 h-3 bg-[var(--color-accent)] rounded-full -left-[7px] border-2 border-surface mt-1" />
          <time
            data-testid={`timeline-time-${entry.id}`}
            className="text-xs text-text-muted"
          >
            {formatTimestamp(entry.timestamp)}
          </time>
          <p className="text-sm text-text-secondary mt-0.5">{entry.action}</p>
        </li>
      ))}
    </ol>
  );
}
