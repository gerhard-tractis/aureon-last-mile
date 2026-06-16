'use client';

import { useState } from 'react';
import { ALL_MODULE_KEYS, MODULES, ModuleKey } from '@/lib/modules/registry';
import { ModuleCard } from './ModuleCard';
import type { OperatorWithModuleState } from './actions';

interface Props {
  operators: OperatorWithModuleState[];
}

export function ModulesAdminPage({ operators }: Props) {
  const [selectedId, setSelectedId] = useState(
    operators[0]?.operator_id ?? '',
  );
  const selected = operators.find((o) => o.operator_id === selectedId);
  const enabledSet = new Set(selected?.enabled_modules ?? []);

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-foreground mb-6">
          Activación de Módulos
        </h1>

        <label className="block mb-6">
          <span className="text-sm font-medium">Operator</span>
          <select
            role="combobox"
            aria-label="operator"
            className="mt-1 block w-full max-w-md rounded border bg-background px-3 py-2"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {operators.map((o) => (
              <option key={o.operator_id} value={o.operator_id}>
                {o.operator_name}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ALL_MODULE_KEYS.map((key: ModuleKey) => (
              <ModuleCard
                key={key}
                operatorId={selected.operator_id}
                moduleKey={key}
                meta={MODULES[key]}
                enabled={enabledSet.has(key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
