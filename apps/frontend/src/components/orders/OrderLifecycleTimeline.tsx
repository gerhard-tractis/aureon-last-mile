import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AuditEntry } from '@/hooks/useOrderDetail';

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

interface Milestone {
  key: string;
  label: string;
  keywords: string[];
}

const MILESTONES: Milestone[] = [
  { key: 'importada', label: 'Importada', keywords: ['csv_import', 'insert_orders', 'order_created'] },
  { key: 'recogida', label: 'Recogida', keywords: ['pickup', 'recogida', 'verificado', 'verified'] },
  { key: 'recepcion', label: 'Recepción', keywords: ['reception', 'recepcion', 'en_bodega', 'warehouse'] },
  { key: 'anden', label: 'Andén', keywords: ['dock', 'anden', 'sector', 'consolidat'] },
  { key: 'reparto', label: 'En reparto', keywords: ['dispatch', 'route', 'en_ruta', 'reparto'] },
  { key: 'entregada', label: 'Entregada', keywords: ['deliver', 'entregad'] },
];

interface Props {
  auditLogs: AuditEntry[];
}

function matchTimestampFor(milestone: Milestone, auditLogs: AuditEntry[]): string | null {
  let latest: string | null = null;
  for (const log of auditLogs) {
    if (!log.timestamp) continue;
    const action = log.action.toLowerCase();
    if (!milestone.keywords.some((kw) => action.includes(kw))) continue;
    if (!latest || log.timestamp > latest) latest = log.timestamp;
  }
  return latest;
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
  const timestamps = MILESTONES.map((m) => matchTimestampFor(m, auditLogs));
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
