'use client';

interface AgentEvent {
  id: string;
  event_type: string;
  meta: Record<string, unknown>;
  created_at: string;
}

interface Props {
  agentEvents: unknown[];
  estimatedCostUsd: number | null;
  modelUsed: string | null;
}

function parseEvent(raw: unknown): AgentEvent {
  const e = raw as Record<string, unknown>;
  return {
    id: String(e.id ?? ''),
    event_type: String(e.event_type ?? ''),
    meta: (e.meta as Record<string, unknown>) ?? {},
    created_at: String(e.created_at ?? ''),
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function getToolName(meta: Record<string, unknown>): string {
  if (typeof meta.tool === 'string') return meta.tool;
  if (typeof meta.type === 'string') return meta.type;
  return '';
}

function getSummary(meta: Record<string, unknown>): string {
  if (typeof meta.summary === 'string') return meta.summary;
  if (typeof meta.message === 'string') return meta.message;
  return '';
}

export function ActivityPanel({ agentEvents, estimatedCostUsd, modelUsed }: Props) {
  if (agentEvents.length === 0 && estimatedCostUsd === null && modelUsed === null) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {agentEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          agentEvents.map((raw) => {
            const ev = parseEvent(raw);
            const tool = getToolName(ev.meta);
            const summary = getSummary(ev.meta);
            return (
              <div key={ev.id} className="rounded-md border border-border bg-card p-2 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-muted-foreground">{formatTime(ev.created_at)}</span>
                  <span className="font-semibold text-foreground truncate">{ev.event_type}</span>
                  {tool && (
                    <span className="ml-auto text-primary font-mono">{tool}</span>
                  )}
                </div>
                {summary && (
                  <p className="text-muted-foreground line-clamp-2">{summary}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {(modelUsed !== null || estimatedCostUsd !== null) && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground flex flex-col gap-0.5">
          {modelUsed && <span>Model: {modelUsed}</span>}
          {estimatedCostUsd !== null && (
            <span>Cost: ~${estimatedCostUsd.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  );
}
