import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface ManifestDetailListProps {
  orders: ManifestOrder[];
  scans: ScanRecord[];
  onManualVerify: (label: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ManifestDetailList({
  orders,
  scans,
  onManualVerify,
  isLoading,
  isError,
  onRetry,
}: ManifestDetailListProps) {
  const totalPackages = useMemo(
    () => orders.reduce((sum, o) => sum + o.packages.length, 0),
    [orders]
  );

  const verifiedCount = useMemo(() => {
    const allPackageIds = new Set(orders.flatMap(o => o.packages.map(p => p.id)));
    const verifiedIds = new Set(
      scans
        .filter(s => s.scan_result === 'verified' && s.package_id)
        .map(s => s.package_id!)
    );
    return [...verifiedIds].filter(id => allPackageIds.has(id)).length;
  }, [orders, scans]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Orders & Packages</CardTitle>
          {!isLoading && !isError && orders.length > 0 && (
            <span className="text-xs text-gray-500">
              {verifiedCount}/{totalPackages} verified
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <div data-testid="manifest-detail-loading" className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-4">
            <p className="text-sm text-red-500 mb-2">Failed to load manifest details</p>
            <Button size="sm" variant="outline" onClick={onRetry} aria-label="Retry">
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && orders.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No orders found for this load</p>
        )}

        {!isLoading && !isError && orders.map(order => (
          <OrderCard
            key={order.id}
            order={order}
            scans={scans}
            onManualVerify={onManualVerify}
          />
        ))}
      </CardContent>
    </Card>
  );
}
