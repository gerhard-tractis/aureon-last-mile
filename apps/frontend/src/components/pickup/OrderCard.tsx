'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { PackageRow } from './PackageRow';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface OrderCardProps {
  order: ManifestOrder;
  scans: ScanRecord[];
  onManualVerify: (label: string) => void;
}

function getBadgeColor(verified: number, total: number): string {
  if (total === 0) return 'gray';
  if (verified === total) return 'green';
  if (verified > 0) return 'yellow';
  return 'gray';
}

const BADGE_CLASSES: Record<string, string> = {
  green: 'bg-status-success-bg text-status-success',
  yellow: 'bg-status-warning-bg text-status-warning',
  gray: 'bg-surface-raised text-text-secondary',
};

export function OrderCard({ order, scans, onManualVerify }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);

  const verifiedPackageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const scan of scans) {
      if (scan.scan_result === 'verified' && scan.package_id) {
        ids.add(scan.package_id);
      }
    }
    return ids;
  }, [scans]);

  const orderPackageIds = new Set(order.packages.map(p => p.id));
  const verifiedCount = [...verifiedPackageIds].filter(id => orderPackageIds.has(id)).length;
  const totalCount = order.packages.length;
  const badgeColor = getBadgeColor(verifiedCount, totalCount);

  return (
    <Card>
      <button
        aria-label="Toggle order details"
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={() => setExpanded(!expanded)}
        onMouseDown={(e) => e.preventDefault()}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-text truncate">{order.order_number}</p>
          <p className="text-xs text-text-secondary truncate">
            {order.customer_name}, {order.comuna}
          </p>
        </div>

        <span
          data-testid="badge"
          className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${BADGE_CLASSES[badgeColor]}`}
        >
          {verifiedCount}/{totalCount}
        </span>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-3 space-y-1">
          <p className="text-xs text-text-muted mb-2 truncate">{order.delivery_address}</p>
          {order.packages.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-2">No packages</p>
          ) : (
            order.packages.map(pkg => (
              <PackageRow
                key={pkg.id}
                pkg={pkg}
                isVerified={verifiedPackageIds.has(pkg.id)}
                onManualVerify={onManualVerify}
              />
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
