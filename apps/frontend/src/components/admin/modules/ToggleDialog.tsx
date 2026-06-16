'use client';

import { useState } from 'react';
import type { ModuleKey } from '@/lib/modules/registry';
import { enableModule, disableModule } from './actions';

interface Props {
  operatorId: string;
  moduleKey: ModuleKey;
  currentlyEnabled: boolean;
  onClose: () => void;
}

export function ToggleDialog({
  operatorId,
  moduleKey,
  currentlyEnabled,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true);
    setError(null);
    try {
      if (currentlyEnabled) {
        await disableModule(operatorId, moduleKey, reason);
      } else {
        await enableModule(operatorId, moduleKey, reason);
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-2">
          {currentlyEnabled ? 'Disable' : 'Enable'} {moduleKey}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          A reason is required. It is stored in the audit log.
        </p>
        <textarea
          role="textbox"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded border bg-background p-2 text-sm"
          rows={3}
          placeholder="e.g. phase-1 go-live"
        />
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm border rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || reason.trim().length === 0}
            className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
