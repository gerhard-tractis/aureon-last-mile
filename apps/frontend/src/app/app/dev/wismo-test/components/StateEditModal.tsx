'use client';

import { useState } from 'react';

interface Props {
  table: 'orders' | 'assignments' | 'dispatches';
  onClose: () => void;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
}

const ASSIGNMENT_STATUSES = ['pending', 'accepted', 'in_transit', 'delivered', 'failed'] as const;

export function StateEditModal({ table, onClose, onSubmit }: Props) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== '') payload[k] = v;
      }
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground capitalize">
            Edit {table}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {table === 'orders' && (
            <>
              <Field label="Customer Name">
                <input type="text" className={inputCls} value={fields.customer_name ?? ''} onChange={(e) => setField('customer_name', e.target.value)} />
              </Field>
              <Field label="Customer Phone">
                <input type="text" className={inputCls} value={fields.customer_phone ?? ''} onChange={(e) => setField('customer_phone', e.target.value)} />
              </Field>
              <Field label="Delivery Date">
                <input type="date" className={inputCls} value={fields.delivery_date ?? ''} onChange={(e) => setField('delivery_date', e.target.value)} />
              </Field>
              <Field label="Window Start">
                <input type="time" className={inputCls} value={fields.delivery_window_start ?? ''} onChange={(e) => setField('delivery_window_start', e.target.value)} />
              </Field>
              <Field label="Window End">
                <input type="time" className={inputCls} value={fields.delivery_window_end ?? ''} onChange={(e) => setField('delivery_window_end', e.target.value)} />
              </Field>
            </>
          )}

          {table === 'assignments' && (
            <Field label="Status">
              <select className={inputCls} value={fields.status ?? ''} onChange={(e) => setField('status', e.target.value)}>
                <option value="">— select —</option>
                {ASSIGNMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}

          {table === 'dispatches' && (
            <>
              <Field label="Estimated At">
                <input type="datetime-local" className={inputCls} value={fields.estimated_at ?? ''} onChange={(e) => setField('estimated_at', e.target.value)} />
              </Field>
              <Field label="Status">
                <input type="text" className={inputCls} value={fields.status ?? ''} onChange={(e) => setField('status', e.target.value)} />
              </Field>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-border bg-background text-foreground text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring';
