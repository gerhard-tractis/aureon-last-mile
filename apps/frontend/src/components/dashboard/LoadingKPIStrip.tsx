import {
  useOrdersLoaded,
  usePackagesLoaded,
  useOrdersCommitted,
  useActiveClients,
  useComunasCovered,
} from '@/hooks/useLoadingMetrics';

interface LoadingKPIStripProps {
  operatorId: string;
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
}

function KPICard({
  label,
  value,
  subtitle,
  isLoading,
}: {
  label: string;
  value: number | undefined;
  subtitle?: string;
  isLoading: boolean;
}) {
  return (
    <div className="bg-surface border border-border rounded-md p-3">
      {isLoading ? (
        <>
          <div className="animate-pulse h-8 w-20 bg-muted rounded mb-1" />
          <div className="animate-pulse h-4 w-28 bg-muted rounded" />
        </>
      ) : (
        <>
          <div className="font-mono text-xl font-semibold text-text leading-none mb-1">
            {(value ?? 0).toLocaleString('es-CL')}
          </div>
          <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
          {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
        </>
      )}
    </div>
  );
}

export default function LoadingKPIStrip({
  operatorId,
  startDate,
  endDate,
}: LoadingKPIStripProps) {
  const ordersLoaded = useOrdersLoaded(operatorId, startDate, endDate);
  const packagesLoaded = usePackagesLoaded(operatorId, startDate, endDate);
  const ordersCommitted = useOrdersCommitted(operatorId, startDate, endDate);
  const activeClients = useActiveClients(operatorId, startDate, endDate);
  const comunasCovered = useComunasCovered(operatorId, startDate, endDate);

  const pkgData = packagesLoaded.data;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <KPICard
        label="Órdenes Cargadas"
        value={ordersLoaded.data}
        isLoading={ordersLoaded.isLoading}
      />
      <KPICard
        label="Bultos Cargados"
        value={pkgData?.packages_count}
        subtitle={pkgData ? `Promedio: ${pkgData.avg_per_order} por orden` : undefined}
        isLoading={packagesLoaded.isLoading}
      />
      <KPICard
        label="Órdenes Comprometidas"
        value={ordersCommitted.data}
        isLoading={ordersCommitted.isLoading}
      />
      <KPICard
        label="Clientes Activos"
        value={activeClients.data}
        isLoading={activeClients.isLoading}
      />
      <KPICard
        label="Comunas Cubiertas"
        value={comunasCovered.data}
        isLoading={comunasCovered.isLoading}
      />
    </div>
  );
}
