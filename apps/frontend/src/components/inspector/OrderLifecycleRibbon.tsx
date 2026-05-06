'use client';

import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { OrderStatus } from '@/lib/types/pipeline';

type StageState = 'done' | 'active' | 'pending';

const LAST_POSITION = PIPELINE_STAGES[PIPELINE_STAGES.length - 1]?.position ?? 8;

function getStageState(stagePosition: number, currentPosition: number): StageState {
  if (currentPosition >= LAST_POSITION) return 'done';
  if (stagePosition < currentPosition) return 'done';
  if (stagePosition === currentPosition) return 'active';
  return 'pending';
}

const stateClasses: Record<StageState, { dot: string; label: string }> = {
  done:    { dot: 'bg-text-muted border-text-muted',                        label: 'text-text-muted' },
  active:  { dot: 'bg-accent border-accent ring-2 ring-accent/30',          label: 'text-text font-semibold' },
  pending: { dot: 'bg-transparent border-border',                           label: 'text-text-faint' },
};

interface Props {
  leadingStatus: string;
}

export function OrderLifecycleRibbon({ leadingStatus }: Props) {
  const currentStage = PIPELINE_STAGES.find((s) => s.status === (leadingStatus as OrderStatus));
  const currentPosition = currentStage?.position ?? 0;

  return (
    <ol className="relative pl-6 border-l-2 border-border">
      {PIPELINE_STAGES.map((stage) => {
        const state = getStageState(stage.position, currentPosition);
        const cls = stateClasses[state];
        return (
          <li
            key={stage.status}
            data-testid={`stage-${stage.status}`}
            data-state={state}
            className="relative mb-4 last:mb-0"
          >
            <span
              className={`absolute -left-[1.45rem] top-1 w-3.5 h-3.5 rounded-full border-2 ${cls.dot}`}
              aria-hidden="true"
            />
            <span className={`text-sm ${cls.label}`}>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
