'use client';

import { Suspense } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { PageShell } from '@/components/PageShell';
import { RealtimeStatusIndicator } from '@/components/operations-control/RealtimeStatusIndicator';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { OpsControlDesktop } from './components/OpsControlDesktop';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();

  if (!operatorId) {
    return <div className="p-4 text-text-muted">Cargando...</div>;
  }

  return (
    <PageShell
      title="Control de Operaciones"
      breadcrumbs={[
        { label: 'Operaciones', href: '/app/dashboard' },
        { label: 'Control de Operaciones' },
      ]}
      actions={<RealtimeStatusIndicator status={realtimeStatus} />}
    >
      {/* Suspense required: OpsControlDesktop uses useSearchParams via useStageQuery */}
      <Suspense fallback={null}>
        <OpsControlDesktop operatorId={operatorId} />
      </Suspense>
    </PageShell>
  );
}
