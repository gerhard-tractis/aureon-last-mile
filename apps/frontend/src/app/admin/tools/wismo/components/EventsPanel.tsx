'use client';

import { useState } from 'react';
import { StateEditModal } from './StateEditModal';

interface Props {
  orderId: string | null;
  onSimulate: (event_type: string, payload?: Record<string, unknown>) => Promise<void>;
  onStateEdit: (table: string, fields: Record<string, unknown>) => Promise<void>;
  loading: boolean;
}

const FAILED_REASONS = [
  { value: 'not_home', label: 'Not home' },
  { value: 'no_access', label: 'No access' },
  { value: 'customer_unreachable', label: 'Customer unreachable' },
  { value: 'address_invalid', label: 'Address invalid' },
] as const;

type StateTable = 'orders' | 'assignments' | 'dispatches';

export function EventsPanel({ orderId, onSimulate, onStateEdit, loading }: Props) {
  const [etaTime, setEtaTime] = useState('');
  const [failedReason, setFailedReason] = useState<string>('not_home');
  const [replyText, setReplyText] = useState('');
  const [editTable, setEditTable] = useState<StateTable | null>(null);
  const [busy, setBusy] = useState(false);

  const disabled = orderId === null || loading || busy;

  async function fire(event_type: string, payload?: Record<string, unknown>) {
    if (disabled) return;
    setBusy(true);
    try {
      await onSimulate(event_type, payload);
    } finally {
      setBusy(false);
    }
  }

  async function handleReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    await fire('client_message', { body: replyText });
    setReplyText('');
  }

  async function handleStateEdit(fields: Record<string, unknown>) {
    if (editTable === null) return;
    await onStateEdit(editTable, fields);
  }

  return (
    <div className="p-4 space-y-5">
      {/* Proactive Events */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Proactive Events</h3>

        <div className="flex flex-wrap gap-2">
          <button
            disabled={disabled}
            onClick={() => fire('proactive_early_arrival')}
            className={btnCls}
          >
            Early Arrival
          </button>
          <button
            disabled={disabled}
            onClick={() => fire('proactive_pickup')}
            className={btnCls}
          >
            Pickup
          </button>
          <button
            disabled={disabled}
            onClick={() => fire('proactive_delivered')}
            className={btnCls}
          >
            Delivered
          </button>
        </div>

        {/* ETA with time input */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">ETA time</label>
          <div className="flex gap-2">
            <input
              type="time"
              aria-label="ETA time"
              value={etaTime}
              onChange={(e) => setEtaTime(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-border bg-background text-foreground text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              disabled={disabled}
              onClick={() => fire('proactive_eta', etaTime ? { estimated_at: etaTime } : undefined)}
              className={btnCls}
            >
              Send ETA
            </button>
          </div>
        </div>

        {/* Failed with reason dropdown */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Fail reason</label>
          <div className="flex gap-2">
            <select
              aria-label="Fail reason"
              value={failedReason}
              onChange={(e) => setFailedReason(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-border bg-background text-foreground text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {FAILED_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              disabled={disabled}
              onClick={() => fire('proactive_failed', { failure_reason: failedReason })}
              className={`${btnCls} bg-destructive text-destructive-foreground hover:opacity-90`}
            >
              Failed
            </button>
          </div>
        </div>
      </section>

      {/* Reactive input */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer Reply</h3>
        <form onSubmit={handleReplySubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Type customer message…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            disabled={disabled}
            className="flex-1 rounded-md border border-border bg-background text-foreground text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || !replyText.trim()}
            className={btnCls}
          >
            Send
          </button>
        </form>
      </section>

      {/* State Editors */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">State Editors</h3>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={disabled}
            onClick={() => setEditTable('orders')}
            className={btnCls}
          >
            Edit Order
          </button>
          <button
            disabled={disabled}
            onClick={() => setEditTable('assignments')}
            className={btnCls}
          >
            Edit Assignment
          </button>
          <button
            disabled={disabled}
            onClick={() => setEditTable('dispatches')}
            className={btnCls}
          >
            Edit Dispatch
          </button>
          <button
            disabled={disabled}
            onClick={() => onStateEdit('reset_session', {})}
            className={`${btnCls} border-destructive text-destructive hover:bg-destructive/10`}
          >
            Reset Session
          </button>
        </div>
      </section>

      {editTable && (
        <StateEditModal
          table={editTable}
          onClose={() => setEditTable(null)}
          onSubmit={handleStateEdit}
        />
      )}
    </div>
  );
}

const btnCls =
  'px-3 py-1.5 text-sm rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
