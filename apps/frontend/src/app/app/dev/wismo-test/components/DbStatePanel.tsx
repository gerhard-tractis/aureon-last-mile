'use client';

import type { TestOrderSnapshot } from '../hooks/types';

interface Props {
  snapshot: TestOrderSnapshot | null;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</h4>
      {value == null ? (
        <p className="text-xs text-muted-foreground italic">—</p>
      ) : (
        <pre className="text-xs bg-muted rounded-md p-2 overflow-x-auto text-foreground whitespace-pre-wrap break-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function DbStatePanel({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-sm text-muted-foreground">Select a test order to view DB state.</p>
      </div>
    );
  }

  const reschedules = snapshot.reschedules ?? [];

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <JsonBlock label="Order" value={snapshot.order} />
      <JsonBlock label="Latest Assignment" value={snapshot.assignment} />
      <JsonBlock label="Latest Dispatch" value={snapshot.dispatch} />

      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Session</h4>
        {snapshot.session == null ? (
          <p className="text-xs text-muted-foreground italic">No active session</p>
        ) : (
          <pre className="text-xs bg-muted rounded-md p-2 overflow-x-auto text-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(snapshot.session, null, 2)}
          </pre>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Order Reschedules ({reschedules.length})
        </h4>
        {reschedules.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">None</p>
        ) : (
          <div className="space-y-1">
            {reschedules.map((r, i) => (
              <pre
                key={i}
                className="text-xs bg-muted rounded-md p-2 overflow-x-auto text-foreground whitespace-pre-wrap break-all"
              >
                {JSON.stringify(r, null, 2)}
              </pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
