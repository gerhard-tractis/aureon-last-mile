/**
 * MobileStatusCards component
 * Displays 4 full-width stacked status filter cards for the mobile OCC view.
 */

import { ChevronRight } from 'lucide-react';
import { useOpsControlFilterStore } from '@/stores/useOpsControlFilterStore';

type StatusKey = 'urgent' | 'alert' | 'ok' | 'late';

export interface MobileStatusCardsProps {
  counts: { urgent: number; alert: number; ok: number; late: number };
  isLoading: boolean;
}

interface CardConfig {
  key: StatusKey;
  label: string;
  borderClass: string;
  activeBgClass: string;
}

const CARDS: CardConfig[] = [
  {
    key: 'urgent',
    label: 'Urgentes',
    borderClass: 'border-[var(--color-status-error)]',
    activeBgClass: 'bg-[var(--color-status-error-bg)]',
  },
  {
    key: 'alert',
    label: 'Alertas',
    borderClass: 'border-[var(--color-status-warning)]',
    activeBgClass: 'bg-[var(--color-status-warning-bg)]',
  },
  {
    key: 'ok',
    label: 'OK',
    borderClass: 'border-[var(--color-status-success)]',
    activeBgClass: 'bg-[var(--color-status-success-bg)]',
  },
  {
    key: 'late',
    label: 'Atrasados',
    borderClass: 'border-border',
    activeBgClass: 'bg-surface-raised',
  },
];

export function MobileStatusCards({ counts, isLoading }: MobileStatusCardsProps) {
  const { statusFilter, setStatusFilter } = useOpsControlFilterStore();

  if (isLoading) {
    return (
      <div data-testid="status-cards-skeleton" className="flex flex-col gap-2 px-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse bg-surface-raised h-[72px] w-full rounded"
          />
        ))}
      </div>
    );
  }

  const handleCardClick = (key: StatusKey) => {
    if (statusFilter === key) {
      setStatusFilter('all');
    } else {
      setStatusFilter(key);
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4">
      {CARDS.map(({ key, label, borderClass, activeBgClass }) => {
        const isActive = statusFilter === key;
        return (
          <div
            key={key}
            data-testid={`status-card-${key}`}
            onClick={() => handleCardClick(key)}
            className={[
              'flex items-center justify-between min-h-[72px] w-full',
              'border-l-4 rounded px-4 cursor-pointer',
              'bg-surface',
              'transition-colors',
              borderClass,
              isActive ? activeBgClass : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex flex-col">
              <span className="text-2xl font-bold font-mono text-text">
                {counts[key]}
              </span>
              <span className="text-sm text-text-muted">{label}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>
        );
      })}
    </div>
  );
}
