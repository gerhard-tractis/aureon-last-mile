'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ClientCount } from '@/hooks/pickup/pickupSummary';

interface ClientFilterProps {
  clients: ClientCount[];
  selected: string | null;
  onSelect: (client: string | null) => void;
}

/**
 * spec-95 fase 8 (mock `5a`, `Recogida.dc.html:88-95`) — each chip carries
 * its own count, "Todos" carries the sum, and the row is labelled CLIENTE
 * ahead of the pills. The counts come from `clientCountsForTab`
 * (`pickupPageHelpers.ts`), scoped to whichever tab is active — see its
 * own docstring for why the union (spec-94 fase 2) decides which chips
 * exist but never what they count (review round 1, B1). Nothing here
 * invents a number: if `clients` is empty, "Todos" reads 0, honestly.
 */
export function ClientFilter({ clients, selected, onSelect }: ClientFilterProps) {
  const { t } = useTranslation();
  const total = clients.reduce((sum, c) => sum + c.count, 0);

  const pillClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
      active
        ? 'bg-accent text-white border-accent'
        : 'bg-surface text-text-secondary border-border hover:border-accent/50'
    }`;

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-secondary">
        Cliente
      </span>
      <div className="flex flex-wrap gap-2">
        <button className={pillClass(selected === null)} onClick={() => onSelect(null)}>
          {t('pickup.all')} · {total}
        </button>
        {clients.map((client) => (
          <button
            key={client.name}
            className={pillClass(selected === client.name)}
            onClick={() => onSelect(client.name)}
          >
            {client.name} · {client.count}
          </button>
        ))}
      </div>
    </div>
  );
}
