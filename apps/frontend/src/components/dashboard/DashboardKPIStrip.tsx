'use client';

import { Package, CheckCircle2, XCircle, Truck } from 'lucide-react';
import { MetricCard } from '@/components/metrics/MetricCard';
import { useOtifMetrics } from '@/hooks/useDeliveryMetrics';

interface DashboardKPIStripProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

function KPIStripSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-surface border border-border rounded-md p-3 animate-pulse h-20" />
      ))}
    </div>
  );
}

export function DashboardKPIStrip({ operatorId, startDate, endDate }: DashboardKPIStripProps) {
  const { data, isLoading } = useOtifMetrics(operatorId, startDate, endDate);

  if (isLoading) return <KPIStripSkeleton />;

  const fmt = (n: number) => n.toLocaleString('es-CL');

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        label="Pedidos Hoy"
        value={data ? fmt(data.total_orders) : '—'}
        icon={Package}
      />
      <MetricCard
        label="Entregados"
        value={data ? fmt(data.delivered_orders) : '—'}
        icon={CheckCircle2}
      />
      <MetricCard
        label="Fallidos"
        value={data ? fmt(data.failed_orders) : '—'}
        icon={XCircle}
      />
      <MetricCard
        label="En Ruta"
        value={data ? fmt(data.in_route_orders) : '—'}
        icon={Truck}
      />
    </div>
  );
}
