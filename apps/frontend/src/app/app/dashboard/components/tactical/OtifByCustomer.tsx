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
import type { OtifByCustomerRow } from '@/hooks/dashboard/useOtifChapter';

interface OtifByCustomerProps {
  data: OtifByCustomerRow[] | undefined;
  isLoading: boolean;
}

function buildDrillUrl(
  searchParams: URLSearchParams,
  customerName: string,
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.set('drill', 'customer');
  params.set('drill_params', btoa(customerName));
  return `?${params.toString()}`;
}

export function OtifByCustomer({ data, isLoading }: OtifByCustomerProps) {
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

  const handleRowClick = (customerName: string) => {
    const url = buildDrillUrl(searchParams, customerName);
    router.replace(url, { scroll: false });
  };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.customer_name}
            className="rounded-lg border bg-card p-3 flex flex-col gap-1 cursor-pointer hover:bg-muted/50"
            onClick={() => handleRowClick(row.customer_name)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{row.customer_name}</span>
              <span className="font-mono tabular-nums text-sm font-semibold">
                {formatPercent(row.otif_pct)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatNumber(row.total_orders)} pedidos
              </span>
              <span className="text-xs text-muted-foreground">
                Δ —
              </span>
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
          <TableHead>Cliente</TableHead>
          <TableHead className="text-right">Pedidos</TableHead>
          <TableHead className="text-right">OTIF</TableHead>
          <TableHead className="text-right">Δ vs anterior</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.customer_name}
            className="cursor-pointer"
            onClick={() => handleRowClick(row.customer_name)}
          >
            <TableCell>{row.customer_name}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatNumber(row.total_orders)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums font-semibold">
              {formatPercent(row.otif_pct)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
              —
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
