'use client';

import { Suspense } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PageShell } from '@/components/PageShell';
import { RealtimeStatusIndicator } from '@/components/operations-control/RealtimeStatusIndicator';
import { useRealtimeStatus } from '@/hooks/useRealtimeStatus';
import { MobileOCC } from '@/components/operations-control/mobile/MobileOCC';
import { OpsControlDesktop } from './components/OpsControlDesktop';

export default function OpsControlPage() {
  const { operatorId } = useOperatorId();
  const realtimeStatus = useRealtimeStatus();
  const isMobile = useIsMobile();

  if (!operatorId) {
    return <div className="p-4 text-text-muted">Cargando...</div>;
  }

  if (isMobile) {
    return <MobileOCC operatorId={operatorId} />;
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
