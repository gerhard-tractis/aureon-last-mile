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
    borderClass: 'border-red-500',
    activeBgClass: 'bg-red-50 dark:bg-red-950',
  },
  {
    key: 'alert',
    label: 'Alertas',
    borderClass: 'border-yellow-500',
    activeBgClass: 'bg-yellow-50 dark:bg-yellow-950',
  },
  {
    key: 'ok',
    label: 'OK',
    borderClass: 'border-green-500',
    activeBgClass: 'bg-green-50 dark:bg-green-950',
  },
  {
    key: 'late',
    label: 'Atrasados',
    borderClass: 'border-gray-500',
    activeBgClass: 'bg-gray-100 dark:bg-gray-800',
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
            className="animate-pulse bg-gray-200 dark:bg-gray-700 h-[72px] w-full rounded"
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
              'bg-card dark:bg-card',
              'transition-colors',
              borderClass,
              isActive ? activeBgClass : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-foreground">
                {counts[key]}
              </span>
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </div>
        );
      })}
    </div>
  );
}
