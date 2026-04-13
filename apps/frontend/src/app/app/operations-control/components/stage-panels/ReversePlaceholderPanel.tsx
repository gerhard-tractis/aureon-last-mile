"use client";

import { StagePanel } from '../StagePanel';
import type { StagePanelProps } from './PickupPanel';

const PLACEHOLDER_KPIS = [
  { label: '— 1', value: '—' },
  { label: '— 2', value: '—' },
  { label: '— 3', value: '—' },
  { label: '— 4', value: '—' },
];

export function ReversePlaceholderPanel(_props: StagePanelProps) {
  return (
    <StagePanel
      title="Logística Inversa"
      subtitle="Etapa 07 · Próximamente"
      deepLink={null}
      kpis={PLACEHOLDER_KPIS}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      lastSyncAt={null}
    >
      <div className="text-center py-8 text-text-secondary text-sm">
        Próximamente
      </div>
    </StagePanel>
  );
}
