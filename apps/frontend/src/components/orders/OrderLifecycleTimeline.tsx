import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AuditEntry } from '@/hooks/useOrderDetail';
import { MILESTONES, milestoneTimestamps } from '@/lib/orders/lifecycle-milestones';

/**
 * spec-65 Task 7 — replaced `OrderLifecycleRibbon` (deleted in Task 8, once
 * `OrderInspector` — its last caller — switched to this component). That
 * component derived position from `orders.leading_status` alone; this one
 * is sourced from `auditLogs` per the brief, matched by keyword against
 * `action` — the generic `audit_trigger_func` writes
 * `resource_type = 'orders'` (plural) while `useOrderDetail`/
 * `useOrderDossier` query `resource_type = 'order'` (singular), so today
 * only manually-inserted rows like `CSV_IMPORT` are ever visible here. That
 * mismatch predates this task and is out of scope to fix; the honest
 * behaviour is that most milestones show no evidence yet (rendered as
 * "future", no timestamp) rather than a fabricated position.
 */

type MilestoneState = 'done' | 'current' | 'future';

interface Props {
  auditLogs: AuditEntry[];
}

function computeStates(timestamps: (string | null)[]): MilestoneState[] {
  let lastMatched = -1;
  timestamps.forEach((ts, i) => {
    if (ts) lastMatched = i;
  });
  if (lastMatched === -1) return timestamps.map(() => 'future');
  return timestamps.map((_, i) => {
    if (i < lastMatched) return 'done';
    if (i === lastMatched) return lastMatched === timestamps.length - 1 ? 'done' : 'current';
    return 'future';
  });
}

const DOT_CLASSES: Record<MilestoneState, string> = {
  done: 'bg-status-success border-status-success',
  current: 'bg-status-error border-status-error ring-4 ring-status-error-bg',
  future: 'border-2 border-border-strong bg-surface',
};

const LINE_CLASSES: Record<MilestoneState, string> = {
  done: 'bg-status-success',
  current: 'bg-border',
  future: 'bg-border',
};

const LABEL_CLASSES: Record<MilestoneState, string> = {
  done: 'text-text-body',
  current: 'font-semibold text-status-error-text',
  future: 'text-text-muted',
};

export function OrderLifecycleTimeline({ auditLogs }: Props) {
  const timestamps = milestoneTimestamps(auditLogs);
  const states = computeStates(timestamps);

  return (
    <ol className="flex items-start gap-0" data-testid="order-lifecycle-timeline">
      {MILESTONES.map((milestone, i) => {
        const state = states[i];
        const timestamp = timestamps[i];
        const isLast = i === MILESTONES.length - 1;
        return (
          <li
            key={milestone.key}
            data-testid={`milestone-${milestone.key}`}
            data-state={state}
            className="flex flex-1 flex-col gap-2"
          >
            <div className="flex items-center">
              <span className={cn('h-3 w-3 flex-none rounded-full', DOT_CLASSES[state])} aria-hidden="true" />
              {!isLast && <span className={cn('h-0.5 flex-1', LINE_CLASSES[state])} aria-hidden="true" />}
            </div>
            <span className={cn('text-[10.5px] leading-tight', LABEL_CLASSES[state])}>
              {milestone.label}
              {timestamp && (
                <>
                  <br />
                  <span className="font-mono text-[10px] text-text-muted">
                    {format(new Date(timestamp), 'dd/MM HH:mm')}
                  </span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
