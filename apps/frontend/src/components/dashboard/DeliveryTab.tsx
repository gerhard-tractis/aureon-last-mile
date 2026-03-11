'use client';

import { useState, useRef } from 'react';
import DateFilterBar, { type DatePreset } from './DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import { useOtifMetrics } from '@/hooks/useDeliveryMetrics';
import OrdersDetailTable from './OrdersDetailTable';
import ActiveRoutesSection from './ActiveRoutesSection';

interface DeliveryTabProps {
  operatorId: string;
}

/* ── Skeleton placeholder ── */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

/* ── Delivery Outcome KPI Card ── */
function OutcomeCard({
  label,
  count,
  total,
  accent,
  isLoading,
  testId,
  onClick,
}: {
  label: string;
  count: number;
  total: number;
  accent: string;
  isLoading: boolean;
  testId: string;
  onClick?: () => void;
}) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-xl p-5 shadow-sm border border-slate-200 hover:shadow-lg hover:scale-[1.01] transition-all duration-300 ${onClick ? 'cursor-pointer' : ''}`}
      data-testid={testId}
      onClick={onClick}
    >
      <div className={`text-3xl font-bold leading-none mb-1 ${accent}`}>
        {count.toLocaleString('es-CL')}
      </div>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-xs text-slate-400 mt-1">{pct}% del total</div>
    </div>
  );
}

/* ── Main DeliveryTab ── */
export default function DeliveryTab({ operatorId }: DeliveryTabProps) {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const ordersRef = useRef<HTMLDivElement>(null);
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<string | null>(null);
  const [ordersOverdueOnly, setOrdersOverdueOnly] = useState(false);

  const { startDate, endDate } = useDatePreset(preset, customStart, customEnd);
  const otif = useOtifMetrics(operatorId, startDate, endDate);
  const otifData = otif.data;

  const scrollToOrders = (status: string | null, overdue = false) => {
    setOrdersStatusFilter(status);
    setOrdersOverdueOnly(overdue);
    setTimeout(() => ordersRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="space-y-6" data-testid="delivery-tab">
      <ActiveRoutesSection operatorId={operatorId} />

      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      {/* Delivery Outcome Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="outcome-strip">
        <OutcomeCard
          label="Entregados"
          count={otifData?.delivered_orders ?? 0}
          total={otifData?.total_orders ?? 0}
          accent="text-emerald-600"
          isLoading={otif.isLoading}
          testId="outcome-delivered"
          onClick={() => scrollToOrders('delivered')}
        />
        <OutcomeCard
          label="Fallidos"
          count={otifData?.failed_orders ?? 0}
          total={otifData?.total_orders ?? 0}
          accent="text-red-600"
          isLoading={otif.isLoading}
          testId="outcome-failed"
          onClick={() => scrollToOrders('failed')}
        />
        <OutcomeCard
          label="En Ruta"
          count={otifData?.in_route_orders ?? 0}
          total={otifData?.total_orders ?? 0}
          accent="text-blue-600"
          isLoading={otif.isLoading}
          testId="outcome-in-route"
          onClick={() => scrollToOrders('pending')}
        />
        <OutcomeCard
          label="Pendientes"
          count={otifData?.pending_orders ?? 0}
          total={otifData?.total_orders ?? 0}
          accent="text-amber-600"
          isLoading={otif.isLoading}
          testId="outcome-pending"
          onClick={() => scrollToOrders('pending')}
        />
      </div>

      {/* Orders Detail Table */}
      <div ref={ordersRef}>
        <OrdersDetailTable
          operatorId={operatorId}
          startDate={startDate}
          endDate={endDate}
          initialStatus={ordersStatusFilter}
          initialOverdueOnly={ordersOverdueOnly}
        />
      </div>
    </div>
  );
}
