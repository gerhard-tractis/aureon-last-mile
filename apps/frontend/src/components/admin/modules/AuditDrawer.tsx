'use client';

import { useEffect, useState } from 'react';
import type { ModuleKey } from '@/lib/modules/registry';
import { fetchAudit, type ModuleAuditEntry } from './actions';

type AuditRow = ModuleAuditEntry;

interface Props {
  operatorId: string;
  moduleKey: ModuleKey;
  onClose: () => void;
}

export function AuditDrawer({ operatorId, moduleKey, onClose }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    fetchAudit(operatorId).then((data) => setRows(data));
  }, [operatorId]);

  const filtered = rows.filter((r) => r.module_key === moduleKey);

  return (
    <div
      role="dialog"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l p-6 overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Audit — {moduleKey}</h2>
        <button type="button" onClick={onClose} className="text-sm">
          Close
        </button>
      </div>
      <ul className="space-y-3">
        {filtered.map((r) => (
          <li
            key={r.id}
            data-testid="audit-entry"
            className="border rounded p-3"
          >
            <div className="text-sm font-medium">
              {r.action} · {new Date(r.at).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              by {r.actor_user_id}
            </div>
            {r.reason && <div className="text-sm mt-1">{r.reason}</div>}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-sm text-muted-foreground">
            No audit entries yet.
          </li>
        )}
      </ul>
    </div>
  );
}
