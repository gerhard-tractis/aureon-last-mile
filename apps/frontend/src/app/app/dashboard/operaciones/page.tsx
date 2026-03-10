'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import SubTabNav, { type TabDefinition } from '@/components/dashboard/SubTabNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import LoadingTab from '@/components/dashboard/LoadingTab';
import DeliveryTab from '@/components/dashboard/DeliveryTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const OPERACIONES_TABS: TabDefinition[] = [
  { id: 'loading', step: '①', label: 'Carga', enabled: true },
  { id: 'pickup', step: '②', label: 'Retiro', enabled: false },
  { id: 'reception', step: '③', label: 'Recepción', enabled: false },
  { id: 'distribution', step: '④', label: 'Distribución', enabled: false },
  { id: 'routing', step: '⑤', label: 'Despacho', enabled: false },
  { id: 'lastmile', step: '⑥', label: 'Última Milla', enabled: true },
];

const VALID_TABS = OPERACIONES_TABS.map((t) => t.id);

function OperacionesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();

  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'loading';

  const handleTabChange = useCallback(
    (tab: string) => router.push(`?tab=${tab}`),
    [router],
  );

  useEffect(() => {
    if (role && !ALLOWED_ROLES.includes(role)) {
      router.push('/app');
    }
  }, [role, router]);

  if (!role) return <HeroSLASkeleton />;
  if (!ALLOWED_ROLES.includes(role)) return null;
  if (!operatorId) return <HeroSLASkeleton />;

  return (
    <div className="space-y-6">
      <OfflineBanner />
      <SubTabNav tabs={OPERACIONES_TABS} activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'loading' && <LoadingTab operatorId={operatorId} />}
      {activeTab === 'lastmile' && <DeliveryTab operatorId={operatorId} />}
    </div>
  );
}

export default function OperacionesPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <OperacionesContent />
    </Suspense>
  );
}
