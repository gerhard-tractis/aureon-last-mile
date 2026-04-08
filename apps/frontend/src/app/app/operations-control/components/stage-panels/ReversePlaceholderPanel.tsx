"use client";

import { DrillDownPanel } from '../DrillDownPanel';
import type { StagePanelProps } from './PickupPanel';

const PLACEHOLDER_KPIS = [
  { label: '— 1', value: '—' },
  { label: '— 2', value: '—' },
  { label: '— 3', value: '—' },
  { label: '— 4', value: '—' },
];

export function ReversePlaceholderPanel(_props: StagePanelProps) {
  return (
    <DrillDownPanel
      title="Logística Inversa"
      subtitle="Etapa 07 · Próximamente"
      deepLink={null}
      kpis={PLACEHOLDER_KPIS}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      lastSyncAt={null}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '2rem',
          color: 'var(--md-dim)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.9rem',
        }}
      >
        Próximamente
      </div>
    </DrillDownPanel>
  );
}
