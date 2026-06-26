'use client';

import { useMemo } from 'react';
import { CheckCircle, Circle, AlertTriangle, Package } from 'lucide-react';
import type {
  RouteReceptionExpectedPackage,
  RouteReceptionScan,
  RouteReceptionManifest,
} from '@/hooks/reception/useRouteReceptionSnapshot';

interface ConsolidatedScanListProps {
  manifests: RouteReceptionManifest[];
  expectedPackages: RouteReceptionExpectedPackage[];
  scans: RouteReceptionScan[];
}

interface OrderGroup {
  orderId: string;
  orderNumber: string;
  retailerName: string | null;
  packages: { id: string; label: string; received: boolean }[];
}

/**
 * Renders expected packages grouped by ORDER (not manifest) and a
 * separate discrepancy section at the bottom for `not_found` /
 * `route_mismatch` scans. This is the cognitive flip that makes
 * consolidated reception usable: the receptionist sees customer-facing
 * groupings rather than the artificial manifest boundary that gets
 * blurred during transit.
 */
export function ConsolidatedScanList({
  manifests,
  expectedPackages,
  scans,
}: ConsolidatedScanListProps) {
  const receivedPackageIds = useMemo(() => {
    return new Set(
      scans
        .filter((s) => s.scan_result === 'received' && s.package_id)
        .map((s) => s.package_id as string),
    );
  }, [scans]);

  const manifestRetailer = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of manifests) map.set(m.id, m.retailer_name);
    return map;
  }, [manifests]);

  const orderGroups: OrderGroup[] = useMemo(() => {
    const groups = new Map<string, OrderGroup>();
    for (const pkg of expectedPackages) {
      if (!groups.has(pkg.order_id)) {
        groups.set(pkg.order_id, {
          orderId: pkg.order_id,
          orderNumber: pkg.order_number,
          retailerName: manifestRetailer.get(pkg.manifest_id) ?? null,
          packages: [],
        });
      }
      groups.get(pkg.order_id)!.packages.push({
        id: pkg.id,
        label: pkg.label,
        received: receivedPackageIds.has(pkg.id),
      });
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.orderNumber.localeCompare(b.orderNumber),
    );
  }, [expectedPackages, manifestRetailer, receivedPackageIds]);

  const discrepancies = useMemo(
    () => scans.filter((s) => s.scan_result === 'not_found' || s.scan_result === 'route_mismatch'),
    [scans],
  );

  if (orderGroups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-text-secondary">
        <Package className="h-8 w-8 opacity-50" />
        <p className="text-sm">No hay paquetes esperados en esta ruta</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orderGroups.map((group) => (
        <div
          key={group.orderId}
          data-testid="order-group"
          data-order-id={group.orderId}
          className="bg-surface border border-border rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm text-text">
              Pedido #{group.orderNumber}
            </p>
            {group.retailerName && (
              <p className="text-xs text-text-secondary">{group.retailerName}</p>
            )}
          </div>
          <div className="space-y-1">
            {group.packages.map((pkg) => (
              <div
                key={pkg.id}
                data-testid="package-row"
                data-package-id={pkg.id}
                data-received={pkg.received ? 'true' : 'false'}
                className={`flex items-center gap-2 p-2 rounded ${
                  pkg.received ? 'bg-status-success-bg' : 'bg-surface-raised'
                }`}
              >
                {pkg.received ? (
                  <CheckCircle
                    className="h-4 w-4 text-status-success flex-shrink-0"
                    data-testid="received-icon"
                  />
                ) : (
                  <Circle className="h-4 w-4 text-text-muted flex-shrink-0" />
                )}
                <span className="font-mono text-sm flex-1 truncate">{pkg.label}</span>
                {pkg.received && (
                  <span className="text-xs text-status-success">Recibido</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {discrepancies.length > 0 && (
        <div
          data-testid="discrepancy-section"
          className="bg-status-error-bg border border-status-error-border rounded-lg p-3"
        >
          <p className="font-semibold text-sm text-status-error flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" />
            Discrepancias ({discrepancies.length})
          </p>
          <ul className="space-y-1">
            {discrepancies.map((d) => (
              <li key={d.id} className="text-xs font-mono text-text">
                {d.barcode}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
