'use client';

import { StatTile } from '@/components/StatTile';

/**
 * spec-54 phase 4.5 — the four count tiles (mock 1e).
 *
 * Missing is derived, not stored: expected minus received, floored at zero.
 * A negative "faltantes" would be nonsense on a counting screen, and the
 * overage it implies is already reported by SOBRANTES.
 */

interface ReceptionCountsProps {
  expected: number;
  received: number;
  unexpected: number;
}

export function ReceptionCounts({ expected, received, unexpected }: ReceptionCountsProps) {
  const missing = Math.max(0, expected - received);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Esperados" value={expected} />
      <StatTile label="Verificados" value={received} tone="success" />
      <StatTile label="Faltantes" value={missing} tone={missing > 0 ? 'warning' : 'neutral'} />
      <StatTile
        label="Sobrantes"
        value={unexpected}
        tone={unexpected > 0 ? 'error' : 'neutral'}
      />
    </div>
  );
}
