'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

interface ClientFilterProps {
  clients: string[];
  selected: string | null;
  onSelect: (client: string | null) => void;
}

export function ClientFilter({ clients, selected, onSelect }: ClientFilterProps) {
  const { t } = useTranslation();

  const pillClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
      active
        ? 'bg-accent text-white border-accent'
        : 'bg-surface text-text-secondary border-border hover:border-accent/50'
    }`;

  return (
    <div className="flex flex-wrap gap-2">
      <button className={pillClass(selected === null)} onClick={() => onSelect(null)}>
        {t('pickup.all')}
      </button>
      {clients.map((client) => (
        <button key={client} className={pillClass(selected === client)} onClick={() => onSelect(client)}>
          {client}
        </button>
      ))}
    </div>
  );
}
