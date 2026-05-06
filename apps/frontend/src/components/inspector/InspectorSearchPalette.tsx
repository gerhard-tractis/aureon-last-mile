'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useOrderSearch } from '@/hooks/useOrderSearch';
import { StatusBadge } from '@/components/StatusBadge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder: (orderId: string) => void;
}

export function InspectorSearchPalette({ isOpen, onClose, onSelectOrder }: Props) {
  const [query, setQuery] = useState('');
  const { data, isLoading } = useOrderSearch(query);

  if (!isOpen) return null;

  const hasResults = (data?.orders.length ?? 0) + (data?.packages.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            autoFocus
            type="text"
            role="textbox"
            placeholder="Buscar orden o paquete…"
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); setQuery(''); } }}
          />
          <kbd className="text-xs text-text-muted bg-surface-raised border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div className="py-2 max-h-80 overflow-y-auto">
            {isLoading && (
              <p className="px-4 py-3 text-sm text-text-muted">Buscando…</p>
            )}

            {!isLoading && !hasResults && (
              <p className="px-4 py-3 text-sm text-text-muted">Sin resultados para &ldquo;{query}&rdquo;</p>
            )}

            {(data?.orders.length ?? 0) > 0 && (
              <>
                <p className="px-4 py-1 text-xs uppercase tracking-widest text-text-faint font-medium">
                  Órdenes
                </p>
                {data!.orders.map((o) => (
                  <button
                    key={o.id}
                    data-result
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-raised text-left transition-colors"
                    onClick={() => { onSelectOrder(o.id); setQuery(''); }}
                  >
                    <div>
                      <span className="text-sm font-mono font-medium text-text">{o.order_number}</span>
                      <span className="ml-2 text-sm text-text-muted">{o.customer_name}</span>
                    </div>
                    <StatusBadge status={o.leading_status} size="sm" />
                  </button>
                ))}
              </>
            )}

            {(data?.packages.length ?? 0) > 0 && (
              <>
                <p className="px-4 py-1 text-xs uppercase tracking-widest text-text-faint font-medium mt-1">
                  Paquetes
                </p>
                {data!.packages.map((p) => (
                  <button
                    key={p.id}
                    data-result
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-raised text-left transition-colors"
                    onClick={() => { onSelectOrder(p.order_id); setQuery(''); }}
                  >
                    <div>
                      <span className="text-sm font-mono font-medium text-text">{p.label}</span>
                      <span className="ml-2 text-xs text-text-muted">→ {p.order_number}</span>
                    </div>
                    <StatusBadge status={p.status} size="sm" />
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {query.length < 2 && (
          <p className="px-4 py-3 text-sm text-text-muted">Escribe al menos 2 caracteres…</p>
        )}
      </div>
    </div>
  );
}
