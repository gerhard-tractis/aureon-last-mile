'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import HeroSLA from '@/components/dashboard/HeroSLA';
import HeroSLASkeleton from '@/components/dashboard/HeroSLASkeleton';
import PrimaryMetricsGrid from '@/components/dashboard/PrimaryMetricsGrid';
import CustomerPerformanceTable from '@/components/dashboard/CustomerPerformanceTable';
import FailedDeliveriesAnalysis from '@/components/dashboard/FailedDeliveriesAnalysis';
import SecondaryMetricsGrid from '@/components/dashboard/SecondaryMetricsGrid';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

export default function DashboardPage() {
  const router = useRouter();
  const { operatorId, role } = useOperatorId();

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
      <HeroSLA operatorId={operatorId} />
      <PrimaryMetricsGrid operatorId={operatorId} />
      <CustomerPerformanceTable operatorId={operatorId} />
      <FailedDeliveriesAnalysis operatorId={operatorId} />
      <SecondaryMetricsGrid operatorId={operatorId} />
    </div>
  );
}
