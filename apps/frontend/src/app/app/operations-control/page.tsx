'use client';

import { Suspense } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { MissionDeck } from './components/MissionDeck';

function MissionDeckShell() {
  const { operatorId } = useOperatorId();
  return <MissionDeck operatorId={operatorId ?? null} />;
}

export default function OpsControlPage() {
  return (
    <Suspense fallback={null}>
      <MissionDeckShell />
    </Suspense>
  );
}
