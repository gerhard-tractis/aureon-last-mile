'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

/** One chip's worth of data — name plus how many manifests it covers. */
export interface ClientCount {
  name: string;
  count: number;
}

interface ClientFilterProps {
  clients: ClientCount[];
  selected: string | null;
  onSelect: (client: string | null) => void;
}

/**
 * spec-95 fase 8 (mock `5a`, `Recogida.dc.html:88-95`) — each chip carries
 * its own count, "Todos" carries the sum, and the row is labelled CLIENTE
 * ahead of the pills. The counts were already computed by
 * `clientBreakdown` (`pickupSummary.ts`) and dropped on the way in — the
 * caller mapped to `.name` before handing the list down. Nothing here
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
