'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import PipelineNav, { type PipelineTab } from '@/components/dashboard/PipelineNav';
import HeroSLA from '@/components/dashboard/HeroSLA';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import PrimaryMetricsGrid from '@/components/dashboard/PrimaryMetricsGrid';
import CustomerPerformanceTable from '@/components/dashboard/CustomerPerformanceTable';
import FailedDeliveriesAnalysis from '@/components/dashboard/FailedDeliveriesAnalysis';
import SecondaryMetricsGrid from '@/components/dashboard/SecondaryMetricsGrid';
import ExportDashboardModal from '@/components/dashboard/ExportDashboardModal';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import LoadingTab from '@/components/dashboard/LoadingTab';
import DeliveryTab from '@/components/dashboard/DeliveryTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { operatorId, role } = useOperatorId();
  const [exportOpen, setExportOpen] = useState(false);

  const activeTab = (searchParams.get('tab') as PipelineTab) || 'overview';

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
      {activeTab === 'overview' && (
        <>
          <HeroSLA operatorId={operatorId} />
          <PrimaryMetricsGrid operatorId={operatorId} />
          <CustomerPerformanceTable operatorId={operatorId} />
          <FailedDeliveriesAnalysis operatorId={operatorId} />
          <SecondaryMetricsGrid operatorId={operatorId} />
          <div className="flex justify-end">
            <button
              onClick={() => setExportOpen(true)}
              className="bg-slate-700 hover:bg-slate-800 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Exportar Reporte
            </button>
          </div>
          <ExportDashboardModal
            open={exportOpen}
            onOpenChange={setExportOpen}
            operatorId={operatorId}
          />
        </>
      )}
      {activeTab === 'loading' && <LoadingTab operatorId={operatorId} />}
      {activeTab === 'delivery' && <DeliveryTab operatorId={operatorId} />}
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
