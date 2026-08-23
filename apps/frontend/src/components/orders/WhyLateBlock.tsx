'use client';

import { STAGE_LABELS, REASON_LABELS } from '@/app/app/operations-control/lib/labels.es';
import type { StageKey } from '@/app/app/operations-control/lib/labels.es';
import { formatDurationSince } from '@/lib/orders/duration';

/**
 * spec-65 Task 7 — the most important block in `1f`. This is the one place
 * in the dossier where the anti-fabrication rule is a hard requirement, not
 * a style preference: with `stage` unknown, `reasonFlag` unknown/unmapped,
 * or no `stuckSinceISO`, the cause is not determinable and the component
 * renders `null` — no placeholder, no generic sentence. Task 5 shipped a
 * fabricated `0` for status counts and had to undo it; this component is
 * built so the equivalent mistake (a fallback "causa desconocida" string)
 * is structurally impossible to add without failing
 * `WhyLateBlock.test.tsx`'s "produces no text content at all" case.
 *
 * The three actions have no backing mutation (spec-65 Decision 3) — each is
 * an optional callback, and a button renders only when its callback prop is
 * supplied. Tasks 8 and 9 supply none today, so none render there.
 *
 * **This block is invisible in production today, by design, not by bug.**
 * `reasonFlag` has no real source anywhere in the codebase yet — the closest
 * candidate, `useAtRiskOrders`'s `reasonFlag` field, reads
 * `order['reason_flag']` off the `get_ops_control_snapshot` RPC, and that
 * RPC returns 19 keys with `reason_flag` in none of them (confirmed against
 * live QA and against every migration that touches the snapshot). Tasks 8/9
 * should not treat "nothing renders" here as a wiring bug on their end until
 * something upstream actually computes `stage` + `reasonFlag` +
 * `stuckSinceISO` for a real order.
 */
interface Props {
  stage: StageKey | null;
  reasonFlag: string | null;
  /** ISO timestamp the order entered `stage`. Null when unknown. */
  stuckSinceISO: string | null;
  now?: Date;
  onReleaseFromConsolidation?: () => void;
  onReassignRoute?: () => void;
  onNotifyClient?: () => void;
}

export function WhyLateBlock({
  stage,
  reasonFlag,
  stuckSinceISO,
  now = new Date(),
  onReleaseFromConsolidation,
  onReassignRoute,
  onNotifyClient,
}: Props) {
  const stageLabel = stage ? STAGE_LABELS[stage] : undefined;
  const reasonLabel = reasonFlag ? REASON_LABELS[reasonFlag] : undefined;

  if (!stageLabel || !reasonLabel || !stuckSinceISO) return null;

  const duration = formatDurationSince(stuckSinceISO, now);

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-status-error-border bg-status-error-bg p-3.5">
      <h3 className="font-heading text-xs font-semibold text-status-error-text">Por qué está atrasada</h3>
      <p className="text-[11.5px] leading-relaxed text-status-error-text">
        La orden está en <strong>{stageLabel}</strong> desde hace <strong>{duration}</strong>. Motivo:{' '}
        {reasonLabel}.
      </p>
      {(onReleaseFromConsolidation || onReassignRoute || onNotifyClient) && (
        <div className="mt-0.5 flex gap-2">
          {onReleaseFromConsolidation && (
            <button
              type="button"
              onClick={onReleaseFromConsolidation}
              className="rounded-md bg-status-error-text px-3 py-2 text-[11.5px] font-semibold text-white"
            >
              Liberar de consolidación
            </button>
          )}
          {onReassignRoute && (
            <button
              type="button"
              onClick={onReassignRoute}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-[11.5px] font-semibold text-text-body"
            >
              Reasignar ruta
            </button>
          )}
          {onNotifyClient && (
            <button
              type="button"
              onClick={onNotifyClient}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-[11.5px] font-semibold text-text-body"
            >
              Avisar al cliente
            </button>
          )}
        </div>
      )}
    </section>
  );
}
