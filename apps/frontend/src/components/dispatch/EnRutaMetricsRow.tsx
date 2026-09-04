import { PackageCheck, Clock, TriangleAlert, Target } from 'lucide-react';
import { MetricCard } from '@/components/metrics/MetricCard';
import type { EnRutaMetrics } from '@/lib/dispatch/en-ruta';

function formatPct(value: number): string {
  return `${value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/**
 * ENTREGADAS / PENDIENTES / FALLIDAS / OTIF DEL DÍA — the header metric row
 * from artboard `1d`. OTIF renders nothing when `metrics.otifPct` is null:
 * that means no dispatch in today's on-road cohort has both a resolved
 * outcome and a promised time to grade against, so there is no fact to
 * report (spec-75 rule: never a proxy under a label asserting a fact).
 */
export function EnRutaMetricsRow({ metrics }: { metrics: EnRutaMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard label="Entregadas" value={metrics.entregadas} icon={PackageCheck} />
      <MetricCard label="Pendientes" value={metrics.pendientes} icon={Clock} />
      <MetricCard label="Fallidas" value={metrics.fallidas} icon={TriangleAlert} />
      {metrics.otifPct !== null && (
        <MetricCard label="OTIF del día" value={formatPct(metrics.otifPct)} icon={Target} />
      )}
    </div>
  );
}
