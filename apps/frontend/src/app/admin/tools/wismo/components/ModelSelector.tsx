'use client';

import { WISMO_TEST_MODELS } from '@/lib/dev/wismo-models';

interface Props {
  value: string;
  onChange: (model: string) => void;
}

export function ModelSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="wismo-model-select" className="text-sm font-medium text-foreground whitespace-nowrap">
        Model
      </label>
      <select
        id="wismo-model-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded-md border border-border bg-card text-foreground text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {WISMO_TEST_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
