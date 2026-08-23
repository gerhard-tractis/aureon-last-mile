'use client';

/**
 * OrderComunaChipsFilter — the ZONA / COMUNA section of `OrderFilterRail`
 * (spec-65, mock `3a`). Split out of the rail so that file stays under the
 * 300-line limit; the "add" affordance's local editing state composed
 * naturally as a standalone component.
 */

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface OrderComunaChipsFilterProps {
  comunas: string[] | null;
  onChange: (comunas: string[] | null) => void;
}

export function OrderComunaChipsFilter({ comunas, onChange }: OrderComunaChipsFilterProps) {
  const [addingZone, setAddingZone] = useState(false);
  const [zoneDraft, setZoneDraft] = useState('');

  function removeComuna(comuna: string) {
    const next = (comunas ?? []).filter((c) => c !== comuna);
    onChange(next.length > 0 ? next : null);
  }

  function commitZoneDraft() {
    const value = zoneDraft.trim();
    if (value) {
      const existing = comunas ?? [];
      if (!existing.includes(value)) onChange([...existing, value]);
    }
    setZoneDraft('');
    setAddingZone(false);
  }

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">ZONA / COMUNA</h3>
      <div className="flex flex-wrap gap-1.5">
        {(comunas ?? []).map((comuna) => (
          <span
            key={comuna}
            className="flex items-center gap-1.5 rounded-sm bg-surface-raised px-1.5 py-1 text-[10.5px] font-medium text-text"
          >
            {comuna}
            <button
              type="button"
              aria-label={`Quitar ${comuna}`}
              onClick={() => removeComuna(comuna)}
              className="text-text-muted hover:text-text"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {addingZone ? (
          <input
            type="text"
            aria-label="Nueva zona"
            autoFocus
            value={zoneDraft}
            onChange={(e) => setZoneDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitZoneDraft()}
            onBlur={commitZoneDraft}
            className="w-24 rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingZone(true)}
            className="flex items-center gap-1 rounded-sm border border-dashed border-border-strong px-1.5 py-1 text-[10.5px] text-text-muted"
          >
            <Plus className="h-2.5 w-2.5" /> añadir
          </button>
        )}
      </div>
    </section>
  );
}
