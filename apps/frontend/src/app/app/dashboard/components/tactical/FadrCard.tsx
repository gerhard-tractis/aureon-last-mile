import { formatPercent } from '@/app/app/dashboard/lib/format';
import { TACTICAL_LABELS } from '@/app/app/dashboard/lib/labels.es';
import { Skeleton } from '@/components/ui/skeleton';

interface RouteTacticsData {
  fadr_pct: number | null;
  avg_km_per_route: number | null;
  avg_km_per_stop: number | null;
  avg_orders_per_route: number | null;
}

interface FadrCardProps {
  data: RouteTacticsData | null;
  isLoading: boolean;
}

export function FadrCard({ data, isLoading }: FadrCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }

  const value = formatPercent(data?.fadr_pct ?? null);

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        FADR
      </span>
      <span className="font-mono tabular-nums text-3xl font-semibold leading-none">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">
        {TACTICAL_LABELS.fadr}
      </span>
    </div>
  );
}
