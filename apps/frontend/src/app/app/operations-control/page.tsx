'use client';

import { useOperatorId } from '@/hooks/useOperatorId';
import { MissionDeck } from './components/MissionDeck';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  return <MissionDeck operatorId={operatorId ?? null} />;
}
