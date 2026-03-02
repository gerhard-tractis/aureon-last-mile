'use client';

import { useMemo, useState } from 'react';
import { getDashboardDates } from '@/hooks/useDashboardDates';
import {
  useFadrMetric,
  useFadrPreviousPeriod,
  useFadrDailySeries,
  useFadrSummary,
  useShortageClaimsMetric,
  useClaimsPreviousPeriod,
  useAvgDeliveryTimeMetric,
  useDeliveryTimePreviousPeriod,
  useDailyMetricsSeries,
  usePerformanceMetricsSummary,
} from '@/hooks/useDashboardMetrics';
import MetricsCard, {
  getMetricColor,
  getMetricHexColor,
  type ColorThresholds,
} from './MetricsCard';
import MetricsCardSkeleton from './MetricsCardSkeleton';
import MetricDrillDownDialog from './MetricDrillDownDialog';

interface PrimaryMetricsGridProps {
  operatorId: string;
}

const FADR_THRESHOLDS: ColorThresholds = { green: 95, yellow: 90, direction: 'higher-better' };
const CLAIMS_THRESHOLDS: ColorThresholds = { green: 50000, yellow: 100000, direction: 'lower-better' };
const EFFICIENCY_THRESHOLDS: ColorThresholds = { green: 40, yellow: 60, direction: 'lower-better' };

/** Estimated daily truck capacity — used for utilization % until real capacity data is available */
const ESTIMATED_DAILY_CAPACITY = 500;

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function formatTrend(current: number | null, previous: number | null, unit: string, lowerIsBetter = false): { text: string; up: boolean } | null {
  if (current === null || previous === null || previous === 0) return null;
  const delta = current - previous;
  const pct = (delta / Math.abs(previous)) * 100;
  const isGood = lowerIsBetter ? delta <= 0 : delta >= 0;
  const arrow = isGood ? '↑' : '↓';

  if (unit === '%') {
    const formatted = `${delta >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    return { text: `${arrow} ${formatted} vs semana anterior`, up: isGood };
  }
  if (unit === 'CLP') {
    const formatted = `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
    return { text: `${arrow} ${formatted} vs semana anterior`, up: isGood };
  }
  // minutes — show absolute change
  const formatted = `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} min`;
  return { text: `${arrow} ${formatted} vs semana anterior`, up: isGood };
}

function getFadrBenchmark(fadr: number | null): string {
  if (fadr === null) return '';
  if (fadr >= 95) return '⭐ Excelente (>95%)';
  if (fadr >= 90) return '✓ Bueno (>90%)';
  return '⚠️ Bajo estándar (<90%)';
}

export default function PrimaryMetricsGrid({ operatorId }: PrimaryMetricsGridProps) {
  const { startDate, endDate, prevStartDate, prevEndDate } = useMemo(() => getDashboardDates(), []);

  const [fadrDialogOpen, setFadrDialogOpen] = useState(false);
  const [claimsDialogOpen, setClaimsDialogOpen] = useState(false);
  const [efficiencyDialogOpen, setEfficiencyDialogOpen] = useState(false);

  // Current period
  const fadrQuery = useFadrMetric(operatorId, startDate, endDate);
  const claimsQuery = useShortageClaimsMetric(operatorId, startDate, endDate);
  const efficiencyQuery = useAvgDeliveryTimeMetric(operatorId, startDate, endDate);
  const perfQuery = usePerformanceMetricsSummary(operatorId, startDate, endDate);

  // Previous period
  const prevFadrQuery = useFadrPreviousPeriod(operatorId, prevStartDate, prevEndDate);
  const prevClaimsQuery = useClaimsPreviousPeriod(operatorId, prevStartDate, prevEndDate);
  const prevEfficiencyQuery = useDeliveryTimePreviousPeriod(operatorId, prevStartDate, prevEndDate);

  // FADR summary for context line (first_attempt / total)
  const fadrSummaryQuery = useFadrSummary(operatorId, startDate, endDate);

  // Sparkline series
  const fadrSeries = useFadrDailySeries(operatorId, startDate, endDate);
  const claimsSeries = useDailyMetricsSeries(operatorId, startDate, endDate, 'shortage_claims_amount_clp');
  const efficiencySeries = useDailyMetricsSeries(operatorId, startDate, endDate, 'avg_delivery_time_minutes');

  const isLoading = fadrQuery.isLoading || claimsQuery.isLoading || efficiencyQuery.isLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
        <MetricsCardSkeleton />
      </div>
    );
  }

  const fadr = fadrQuery.data ?? null;
  const claims = claimsQuery.data;
  const efficiency = efficiencyQuery.data ?? null;
  const perf = perfQuery.data;

  const fadrTrend = formatTrend(fadr, prevFadrQuery.data ?? null, '%');
  const claimsTrend = formatTrend(
    claims?.amount ?? null,
    prevClaimsQuery.data?.amount ?? null,
    'CLP',
    true
  );
  const efficiencyTrend = formatTrend(efficiency, prevEfficiencyQuery.data ?? null, 'min', true);

  const fadrColor = getMetricColor(fadr, FADR_THRESHOLDS);
  const fadrHex = getMetricHexColor(fadr, FADR_THRESHOLDS);

  const claimsAmount = claims?.amount ?? 0;
  const claimsColor = getMetricColor(claimsAmount, CLAIMS_THRESHOLDS);
  const claimsHex = getMetricHexColor(claimsAmount, CLAIMS_THRESHOLDS);

  const efficiencyColor = getMetricColor(efficiency, EFFICIENCY_THRESHOLDS);
  const efficiencyHex = getMetricHexColor(efficiency, EFFICIENCY_THRESHOLDS);

  // FADR context: X/Y primera entrega exitosa (using first_attempt_deliveries, not delivered_orders)
  const fadrSummary = fadrSummaryQuery.data;
  const fadrContext = fadrSummary
    ? `${fadrSummary.firstAttempt}/${fadrSummary.total} primera entrega exitosa`
    : 'Sin datos para este periodo';

  const claimsContext = claims ? `${claims.count} reclamos en periodo` : 'Sin datos para este periodo';

  const efficiencyContext = perf ? `${perf.totalOrders} pedidos procesados` : 'Sin datos para este periodo';

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* FADR Card */}
        <MetricsCard
          title="FADR"
          icon="🎯"
          value={fadr !== null ? `${fadr.toFixed(1)}%` : 'N/A'}
          color={fadrColor}
          trend={fadrTrend?.text}
          trendUp={fadrTrend?.up}
          context={fadrContext}
          sparklineData={fadrSeries.data}
          sparklineColor={fadrHex}
          benchmarkBadge={getFadrBenchmark(fadr)}
          tooltipText="Primera Entrega: Porcentaje de entregas exitosas en el primer intento. >95% = excelente, >90% = bueno. Reduce costos de re-entregas."
          onClick={() => setFadrDialogOpen(true)}
          ariaLabel={`FADR: ${fadr !== null ? fadr.toFixed(1) + '%' : 'Sin datos'}. Click para ver detalles.`}
          isStale={fadrQuery.isError}
        />

        {/* Claims Card */}
        <MetricsCard
          title="Reclamos"
          icon="💰"
          value={claims ? clpFormatter.format(claimsAmount) : '0 CLP'}
          color={claims ? claimsColor : 'text-[#10b981]'}
          trend={claimsTrend?.text}
          trendUp={claimsTrend?.up}
          context={claimsContext}
          sparklineData={claimsSeries.data}
          sparklineColor={claimsHex}
          roiLine={prevClaimsQuery.data && claims ? `💾 Ahorro: ${clpFormatter.format(Math.max(0, prevClaimsQuery.data.amount - claims.amount))} este mes` : undefined}
          tooltipText="Reclamos de Indemnización: Multas por diferencias entre manifest y entrega. Sistema previene al detectar discrepancias ANTES de firmar."
          onClick={() => setClaimsDialogOpen(true)}
          ariaLabel={`Reclamos: ${claims ? clpFormatter.format(claimsAmount) : '0 CLP'}. Click para ver detalles.`}
          isStale={claimsQuery.isError}
        />

        {/* Efficiency Card */}
        <MetricsCard
          title="Eficiencia"
          icon="⚡"
          value={efficiency !== null ? `${Math.round(efficiency)} min` : 'N/A'}
          color={efficiencyColor}
          trend={efficiencyTrend?.text}
          trendUp={efficiencyTrend?.up}
          context={efficiencyContext}
          sparklineData={efficiencySeries.data}
          sparklineColor={efficiencyHex}
          capacityLine={perf ? `📊 ${perf.totalOrders > 0 ? Math.round((perf.totalOrders / ESTIMATED_DAILY_CAPACITY) * 100) : 0}% capacidad` : undefined}
          tooltipText="Tiempo promedio de carga por camión. Manual: ~2 horas. Con Aureon: 42 minutos. Ahorro: 78 minutos/camión."
          onClick={() => setEfficiencyDialogOpen(true)}
          ariaLabel={`Eficiencia: ${efficiency !== null ? Math.round(efficiency) + ' minutos' : 'Sin datos'}. Click para ver detalles.`}
          isStale={efficiencyQuery.isError}
        />
      </div>

      {/* Drill-down dialogs */}
      <MetricDrillDownDialog
        open={fadrDialogOpen}
        onOpenChange={setFadrDialogOpen}
        title="FADR - Analisis Detallado"
        description="Historial de 30 dias y desglose por retailer"
      >
        <ul className="space-y-2 text-slate-700 text-sm">
          <li>Grafico historico de 30 dias</li>
          <li>Desglose por retailer</li>
          <li>Indicador benchmark: {getFadrBenchmark(fadr)}</li>
        </ul>
      </MetricDrillDownDialog>

      <MetricDrillDownDialog
        open={claimsDialogOpen}
        onOpenChange={setClaimsDialogOpen}
        title="Reclamos - Analisis Detallado"
        description="Desglose de reclamos y tendencias"
      >
        <ul className="space-y-2 text-slate-700 text-sm">
          <li>Cantidad de reclamos: {claims?.count ?? 0}</li>
          <li>Monto promedio: {claims && claims.count > 0 ? clpFormatter.format(Math.round(claimsAmount / claims.count)) : 'N/A'}</li>
          <li>Grafico historico de 30 dias</li>
          <li>Desglose por retailer</li>
        </ul>
      </MetricDrillDownDialog>

      <MetricDrillDownDialog
        open={efficiencyDialogOpen}
        onOpenChange={setEfficiencyDialogOpen}
        title="Eficiencia - Analisis Detallado"
        description="Tiempo promedio de carga y tendencias"
      >
        <ul className="space-y-2 text-slate-700 text-sm">
          <li>Tiempo promedio: {efficiency !== null ? `${Math.round(efficiency)} min` : 'N/A'}</li>
          <li>Tendencia de 30 dias</li>
          <li>Comparacion manual vs Aureon</li>
        </ul>
      </MetricDrillDownDialog>
    </>
  );
}
