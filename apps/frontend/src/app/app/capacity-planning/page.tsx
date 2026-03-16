'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';
import CapacityCalendar from '@/components/capacity/CapacityCalendar';
import CapacityUtilizationSummary from '@/components/capacity/CapacityUtilizationSummary';
import CapacityAccuracyRanking from '@/components/capacity/CapacityAccuracyRanking';

const ALLOWED_ROLES = ['operations_manager', 'admin'];

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function CapacityPlanningContent() {
  const router = useRouter();
  const { operatorId, role } = useOperatorId();

  useEffect(() => {
    if (role && !ALLOWED_ROLES.includes(role)) {
      router.push('/app/dashboard');
    }
  }, [role, router]);

  if (!role) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!ALLOWED_ROLES.includes(role)) return null;

  if (!operatorId) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const currentMonth = getCurrentMonth();

  return (
    <div className="space-y-8 p-4">
      <h1 className="text-2xl font-bold text-foreground">Planificación de Capacidad</h1>

      {/* Calendar section */}
      <section className="bg-card border rounded-lg p-4 shadow-sm">
        <CapacityCalendar operatorId={operatorId} initialMonth={currentMonth} />
      </section>

      {/* Utilization summary */}
      <section className="bg-card border rounded-lg p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Resumen de Utilización — {currentMonth}
        </h2>
        <CapacityUtilizationSummary operatorId={operatorId} month={currentMonth} />
      </section>

      {/* Forecast accuracy ranking */}
      <section className="bg-card border rounded-lg p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Ranking de Precisión de Pronóstico
        </h2>
        <CapacityAccuracyRanking operatorId={operatorId} month={currentMonth} />
      </section>
    </div>
  );
}

export default function CapacityPlanningPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <CapacityPlanningContent />
    </Suspense>
  );
}
