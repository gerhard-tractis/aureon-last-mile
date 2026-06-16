'use client';

import { useState } from 'react';
import type { ModuleKey, ModuleMeta } from '@/lib/modules/registry';
import { ToggleDialog } from './ToggleDialog';
import { AuditDrawer } from './AuditDrawer';

interface Props {
  operatorId: string;
  moduleKey: ModuleKey;
  meta: ModuleMeta;
  enabled: boolean;
}

export function ModuleCard({ operatorId, moduleKey, meta, enabled }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div
      data-testid={`module-card-${moduleKey}`}
      data-card="module-card"
      data-enabled={enabled ? 'true' : 'false'}
      className="rounded-lg border bg-card p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{meta.label}</h3>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <span
          className={`px-2 py-0.5 text-xs rounded ${
            enabled
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm"
          onClick={() => setDialogOpen(true)}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={() => setAuditOpen(true)}
        >
          View audit
        </button>
      </div>
      {dialogOpen && (
        <ToggleDialog
          operatorId={operatorId}
          moduleKey={moduleKey}
          currentlyEnabled={enabled}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {auditOpen && (
        <AuditDrawer
          operatorId={operatorId}
          moduleKey={moduleKey}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}
