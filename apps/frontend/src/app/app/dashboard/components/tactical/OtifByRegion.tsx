import { useRouter, useSearchParams } from 'next/navigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import { formatPercent, formatNumber } from '@/app/app/dashboard/lib/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

interface RegionRow {
  region_name: string;
  total_orders: number;
  delivered_orders: number;
  otif_pct: number;
}

interface OtifByRegionProps {
  data: RegionRow[] | undefined;
  isLoading: boolean;
}

const INSUFFICIENT_THRESHOLD = 5;

function buildDrillUrl(
  searchParams: URLSearchParams,
  regionName: string,
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.set('drill', 'region');
  params.set('drill_params', btoa(regionName));
  return `?${params.toString()}`;
}

export function OtifByRegion({ data, isLoading }: OtifByRegionProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const rows = data ?? [];

  const handleRowClick = (regionName: string) => {
    const url = buildDrillUrl(searchParams, regionName);
    router.replace(url, { scroll: false });
  };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.region_name}
            className="rounded-lg border bg-card p-3 flex flex-col gap-1 cursor-pointer hover:bg-muted/50"
            onClick={() => handleRowClick(row.region_name)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{row.region_name}</span>
              <span className="font-mono tabular-nums text-sm font-semibold">
                {formatPercent(row.otif_pct)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatNumber(row.total_orders)} pedidos
              </span>
              {row.total_orders < INSUFFICIENT_THRESHOLD && (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  muestra insuficiente
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Región</TableHead>
          <TableHead className="text-right">Pedidos</TableHead>
          <TableHead className="text-right">OTIF</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.region_name}
            className="cursor-pointer"
            onClick={() => handleRowClick(row.region_name)}
          >
            <TableCell>
              <div className="flex items-center gap-2">
                {row.region_name}
                {row.total_orders < INSUFFICIENT_THRESHOLD && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    muestra insuficiente
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatNumber(row.total_orders)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums font-semibold">
              {formatPercent(row.otif_pct)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
