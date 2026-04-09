'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDashboardPeriod } from '@/hooks/dashboard/useDashboardPeriod';
import { PageShell } from '@/components/PageShell';
import { DashboardHeader } from '@/app/app/dashboard/components/DashboardHeader';
import { NorthStarStrip } from '@/app/app/dashboard/components/NorthStarStrip';
import { CpoChapter } from '@/app/app/dashboard/components/chapters/CpoChapter';
import { OtifChapter } from '@/app/app/dashboard/components/chapters/OtifChapter';
import { NpsChapter } from '@/app/app/dashboard/components/chapters/NpsChapter';
import { DrillSheet } from '@/app/app/dashboard/components/drill/DrillSheet';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="animate-pulse p-6">
      <div className="h-8 bg-muted rounded w-48" />
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { operatorId, role } = useOperatorId();
  const { period, setPreset, setCustomRange } = useDashboardPeriod();

  useEffect(() => {
    if (role && !ALLOWED_ROLES.includes(role)) {
      router.push('/app');
    }
  }, [role, router]);

  if (!role) return <DashboardSkeleton />;
  if (!ALLOWED_ROLES.includes(role)) return null;
  if (!operatorId) return <DashboardSkeleton />;

  return (
    <PageShell title="Dashboard ejecutivo">
      <DashboardHeader
        period={period}
        onSetPreset={setPreset}
        onSetCustomRange={setCustomRange}
      />
      <NorthStarStrip operatorId={operatorId} year={period.year} month={period.month} />
      <main className="max-w-7xl mx-auto space-y-16 py-8 px-4 md:px-6 lg:px-8">
        <CpoChapter operatorId={operatorId} period={period} />
        <OtifChapter operatorId={operatorId} period={period} />
        <NpsChapter operatorId={operatorId} period={period} />
      </main>
      <DrillSheet />
      <footer className="text-xs text-muted-foreground text-center py-6 border-t">
        Dashboard ejecutivo · datos pre-agregados · sincronizado por cron 02:30 UTC
      </footer>
    </PageShell>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
