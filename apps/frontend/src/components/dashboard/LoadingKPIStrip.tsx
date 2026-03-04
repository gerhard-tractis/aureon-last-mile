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
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 hover:shadow-lg hover:scale-[1.01] transition-all duration-300">
      {isLoading ? (
        <>
          <div className="animate-pulse h-8 w-20 bg-slate-200 rounded mb-1" />
          <div className="animate-pulse h-4 w-28 bg-slate-100 rounded" />
        </>
      ) : (
        <>
          <div className="text-3xl font-bold text-slate-800 leading-none mb-1">
            {(value ?? 0).toLocaleString('es-CL')}
          </div>
          <div className="text-sm text-slate-500">{label}</div>
          {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
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
