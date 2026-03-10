'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import PipelineNav, { type PipelineTab } from '@/components/dashboard/PipelineNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import LoadingTab from '@/components/dashboard/LoadingTab';
import DeliveryTab from '@/components/dashboard/DeliveryTab';
import OtifTab from '@/components/analytics/OtifTab';
import UnitEconomicsTab from '@/components/analytics/UnitEconomicsTab';
import CxTab from '@/components/analytics/CxTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const VALID_TABS: PipelineTab[] = [
  'loading', 'pickup', 'reception', 'distribution', 'routing', 'lastmile',
  'analytics_otif', 'analytics_unit_economics', 'analytics_cx',
];

function isValidTab(tab: string | null): tab is PipelineTab {
  return VALID_TABS.includes(tab as PipelineTab);
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();

  const rawTab = searchParams.get('tab');
  // Legacy redirect: old 'delivery' param → 'lastmile'
  const resolvedTab = rawTab === 'delivery' ? 'lastmile' : rawTab;
  const activeTab: PipelineTab = isValidTab(resolvedTab) ? resolvedTab : 'loading';

  const handleTabChange = useCallback(
    (tab: PipelineTab) => {
      router.push(`?tab=${tab}`);
    },
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
      <PipelineNav activeTab={activeTab} onTabChange={handleTabChange} />
      {activeTab === 'loading' && <LoadingTab operatorId={operatorId} />}
      {activeTab === 'lastmile' && <DeliveryTab operatorId={operatorId} />}
      {activeTab === 'analytics_otif' && <OtifTab operatorId={operatorId} />}
      {activeTab === 'analytics_unit_economics' && <UnitEconomicsTab operatorId={operatorId} />}
      {activeTab === 'analytics_cx' && <CxTab operatorId={operatorId} />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
