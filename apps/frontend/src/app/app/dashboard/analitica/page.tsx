'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import { PageShell } from '@/components/PageShell';
import SubTabNav, { type TabDefinition } from '@/components/dashboard/SubTabNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import { DashboardPageNav } from '@/components/dashboard/DashboardPageNav';
import OtifTab from '@/components/analytics/OtifTab';
import UnitEconomicsTab from '@/components/analytics/UnitEconomicsTab';
import CxTab from '@/components/analytics/CxTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const ANALITICA_TABS: TabDefinition[] = [
  { id: 'otif', label: 'OTIF', enabled: true },
  { id: 'unit_economics', label: 'Unit Economics', enabled: false },
  { id: 'cx', label: 'CX', enabled: false },
];

const VALID_TABS = ANALITICA_TABS.map((t) => t.id);

function AnaliticaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();

  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'otif';

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
    <PageShell
      title="Analítica"
      breadcrumbs={[
        { label: 'Dashboard', href: '/app/dashboard' },
        { label: 'Analítica' },
      ]}
    >
      <OfflineBanner />
      <DashboardPageNav />
      <SubTabNav tabs={ANALITICA_TABS} activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'otif' && <OtifTab operatorId={operatorId} />}
      {activeTab === 'unit_economics' && <UnitEconomicsTab operatorId={operatorId} />}
      {activeTab === 'cx' && <CxTab operatorId={operatorId} />}
    </PageShell>
  );
}

export default function AnaliticaPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <AnaliticaContent />
    </Suspense>
  );
}
