'use client';

import { useState, useRef } from 'react';
import DateFilterBar, { type DatePreset } from './DateFilterBar';
import { useDatePreset } from '@/hooks/useDatePreset';
import { useOtifMetrics, usePendingOrders } from '@/hooks/useDeliveryMetrics';
import OtifByRetailerTable from './OtifByRetailerTable';
import LateDeliveriesTable from './LateDeliveriesTable';
import OrdersDetailTable from './OrdersDetailTable';

interface DeliveryTabProps {
  operatorId: string;
}

/* ── Color thresholds for OTIF ── */
function getOtifColor(pct: number | null): {
  text: string;
  bg: string;
  ring: string;
  glow: string;
} {
  if (pct === null || isNaN(pct))
    return { text: 'text-slate-400', bg: 'bg-slate-50', ring: 'ring-slate-200', glow: '' };
  if (pct >= 95)
    return {
      text: 'text-emerald-600',
      bg: 'bg-emerald-50',
      ring: 'ring-emerald-200',
      glow: 'shadow-emerald-100',
    };
  if (pct >= 85)
    return {
      text: 'text-amber-600',
      bg: 'bg-amber-50',
      ring: 'ring-amber-200',
      glow: 'shadow-amber-100',
    };
  return {
    text: 'text-red-600',
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    glow: 'shadow-red-100',
  };
}

/* ── Skeleton placeholder ── */
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

/* ── OTIF Hero Card (AC #4) ── */
function OtifHeroCard({
  otifPct,
  delivered,
  total,
  isLoading,
}: {
  otifPct: number | null;
  delivered: number;
  total: number;
  isLoading: boolean;
}) {
  const color = getOtifColor(otifPct);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200" data-testid="otif-hero-skeleton">
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-16 w-40 mb-3" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }

  const displayPct = otifPct !== null ? otifPct.toFixed(1) : '—';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-8 shadow-md ${color.bg} ring-1 ${color.ring} ${color.glow} transition-all duration-500`}
      data-testid="otif-hero"
    >
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 0, transparent 50%)',
        backgroundSize: '12px 12px',
      }} />

      <div className="relative">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">
          OTIF — Entregas a Tiempo
        </h3>
        <div className={`text-6xl sm:text-7xl font-black leading-none tracking-tight mb-3 ${color.text}`}>
          {displayPct}
          {otifPct !== null && <span className="text-3xl sm:text-4xl ml-1">%</span>}
        </div>
        <p className="text-sm text-slate-600">
          {delivered.toLocaleString('es-CL')} de {total.toLocaleString('es-CL')} pedidos entregados
        </p>
      </div>
    </div>
  );
}

/* ── Delivery Outcome KPI Card (AC #5) ── */
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

/* ── Pending Alert Card (AC #6) ── */
function PendingAlertCard({
  label,
  count,
  accent,
  pulse,
  isLoading,
  testId,
  onClick,
}: {
  label: string;
  count: number;
  accent: string;
  pulse: boolean;
  isLoading: boolean;
  testId: string;
  onClick?: () => void;
}) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl p-5 shadow-sm border transition-all duration-300 hover:shadow-lg hover:scale-[1.01] ${accent} ${onClick ? 'cursor-pointer' : ''}`}
      data-testid={testId}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold leading-none">
          {count.toLocaleString('es-CL')}
        </span>
        {pulse && count > 0 && (
          <span className="relative flex h-3 w-3" data-testid="overdue-pulse">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
        )}
      </div>
      <div className="text-sm mt-1 opacity-80">{label}</div>
    </div>
  );
}

/* ── Main DeliveryTab (AC #3-7) ── */
export default function DeliveryTab({ operatorId }: DeliveryTabProps) {
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const ordersRef = useRef<HTMLDivElement>(null);
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<string | null>(null);
  const [ordersOverdueOnly, setOrdersOverdueOnly] = useState(false);

  const { startDate, endDate } = useDatePreset(preset, customStart, customEnd);

  const otif = useOtifMetrics(operatorId, startDate, endDate);
  const pending = usePendingOrders(operatorId);

  const otifData = otif.data;
  const pendingData = pending.data;

  const scrollToOrders = (status: string | null, overdue = false) => {
    setOrdersStatusFilter(status);
    setOrdersOverdueOnly(overdue);
    setTimeout(() => ordersRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="space-y-6" data-testid="delivery-tab">
      <DateFilterBar
        preset={preset}
        customStart={customStart}
        customEnd={customEnd}
        onPresetChange={setPreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      {/* OTIF Hero (AC #4) */}
      <OtifHeroCard
        otifPct={otifData?.otif_percentage ?? null}
        delivered={otifData?.delivered_orders ?? 0}
        total={otifData?.total_orders ?? 0}
        isLoading={otif.isLoading}
      />

      {/* Delivery Outcome Strip (AC #5) */}
      <div className="grid grid-cols-3 gap-4" data-testid="outcome-strip">
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
          label="Pendientes"
          count={otifData?.pending_orders ?? 0}
          total={otifData?.total_orders ?? 0}
          accent="text-amber-600"
          isLoading={otif.isLoading}
          testId="outcome-pending"
          onClick={() => scrollToOrders('pending')}
        />
      </div>

      {/* Pending Orders Alert Strip (AC #6) */}
      <div className="grid grid-cols-3 gap-4" data-testid="pending-strip">
        <PendingAlertCard
          label="Atrasados"
          count={pendingData?.overdue_count ?? 0}
          accent="bg-red-50 border-red-200 text-red-700"
          pulse={true}
          isLoading={pending.isLoading}
          testId="pending-overdue"
          onClick={() => scrollToOrders(null, true)}
        />
        <PendingAlertCard
          label="Para Hoy"
          count={pendingData?.due_today_count ?? 0}
          accent="bg-amber-50 border-amber-200 text-amber-700"
          pulse={false}
          isLoading={pending.isLoading}
          testId="pending-today"
        />
        <PendingAlertCard
          label="Para Mañana"
          count={pendingData?.due_tomorrow_count ?? 0}
          accent="bg-slate-50 border-slate-200 text-slate-700"
          pulse={false}
          isLoading={pending.isLoading}
          testId="pending-tomorrow"
        />
      </div>

      {/* OTIF by Retailer (detail) */}
      <OtifByRetailerTable operatorId={operatorId} startDate={startDate} endDate={endDate} />

      {/* Late Deliveries (detail) */}
      <LateDeliveriesTable operatorId={operatorId} startDate={startDate} endDate={endDate} />

      {/* Orders Detail Table (detail) */}
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
