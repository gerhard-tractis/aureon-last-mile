'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import { useDatePreset } from '@/hooks/useDatePreset';
import { PageShell } from '@/components/PageShell';
import DateFilterBar, { type DatePreset } from '@/components/dashboard/DateFilterBar';
import HeroSLA from '@/components/dashboard/HeroSLA';
import { DashboardKPIStrip } from '@/components/dashboard/DashboardKPIStrip';
import DailyOrdersChart from '@/components/dashboard/DailyOrdersChart';
import CommittedOrdersChart from '@/components/dashboard/CommittedOrdersChart';
import SubTabNav, { type TabDefinition } from '@/components/dashboard/SubTabNav';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import OfflineBanner from '@/components/dashboard/OfflineBanner';
import CustomerPerformanceTable from '@/components/dashboard/CustomerPerformanceTable';
import LoadingTab from '@/components/dashboard/LoadingTab';
import DeliveryTab from '@/components/dashboard/DeliveryTab';
import { DistributionTab } from '@/components/dashboard/DistributionTab';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

const OPERACIONES_TABS: TabDefinition[] = [
  { id: 'loading', step: '①', label: 'Carga', enabled: true },
  { id: 'pickup', step: '②', label: 'Retiro', enabled: false },
  { id: 'reception', step: '③', label: 'Recepción', enabled: false },
  { id: 'distribution', step: '④', label: 'Distribución', enabled: true },
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

  // Page-level date filter for command center
  const [preset, setPreset] = useState<DatePreset>('last_7_days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const { startDate, endDate } = useDatePreset(preset, customStart, customEnd);

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
      title="Operaciones"
      breadcrumbs={[
        { label: 'Dashboard', href: '/app/dashboard' },
        { label: 'Operaciones' },
      ]}
      actions={
        <DateFilterBar
          preset={preset}
          customStart={customStart}
          customEnd={customEnd}
          onPresetChange={setPreset}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          inline
        />
      }
    >
      <OfflineBanner />

      {/* Command center: HeroSLA + KPIs */}
      <div className="space-y-3 mb-4">
        <HeroSLA operatorId={operatorId} startDate={startDate} endDate={endDate} />
        <DashboardKPIStrip operatorId={operatorId} startDate={startDate} endDate={endDate} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <DailyOrdersChart operatorId={operatorId} startDate={startDate} endDate={endDate} />
        <CommittedOrdersChart operatorId={operatorId} startDate={startDate} endDate={endDate} />
      </div>

      {/* Operational stage tabs */}
      <div className="space-y-4 mb-4">
        <SubTabNav tabs={OPERACIONES_TABS} activeTab={activeTab} onTabChange={handleTabChange} />
        {activeTab === 'loading' && <LoadingTab operatorId={operatorId} />}
        {activeTab === 'distribution' && <DistributionTab operatorId={operatorId} />}
        {activeTab === 'lastmile' && <DeliveryTab operatorId={operatorId} />}
      </div>

      {/* Client performance */}
      <CustomerPerformanceTable operatorId={operatorId} />
    </PageShell>
  );
}

export default function OperacionesPage() {
  return (
    <Suspense fallback={<HeroSLASkeleton />}>
      <OperacionesContent />
    </Suspense>
  );
}
