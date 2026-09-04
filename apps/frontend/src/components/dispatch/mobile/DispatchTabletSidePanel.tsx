'use client';

import { RouteTrackingVehiclePanel } from '../RouteTrackingVehiclePanel';
import { DispatchScanRejectionSummary } from './DispatchScanRejectionSummary';
import { DispatchScanHistoryList } from './DispatchScanHistoryList';
import { DispatchTabletIncompleteOrders } from './DispatchTabletIncompleteOrders';
import type { RejectionTallyRow } from '@/lib/dispatch/mobile/scan-session';
import type { ScanHistoryEntry } from '@/lib/dispatch/mobile/scan-session';
import type { IncompleteOrder, OrderBoxCount } from '@/lib/dispatch/mobile/route-load-brief';

export interface DispatchTabletSidePanelProps {
  vehicleExternalId: string | null;
  driverName: string | null;
  packagesLoaded: number;
  vehicleCapacityPackages: number | null;
  ordersCount: number;
  stopsCount: number;
  pendingOnDock: number;
  rejectionCount: number;
  rejectionTally: readonly RejectionTallyRow[];
  history: readonly ScanHistoryEntry[];
  incompleteOrders: IncompleteOrder[];
  orderBoxCounts: ReadonlyMap<string, OrderBoxCount>;
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-surface-raised px-3 py-2 text-center">
      <div className="font-mono text-[20px] font-bold text-text">{value}</div>
      <div className="mt-px text-[10.5px] text-text-muted">{label}</div>
    </div>
  );
}

/**
 * spec-78 (`3a`) — the tablet's right column: vehicle + occupancy (`1c`'s
 * `RouteTrackingVehiclePanel`, reused verbatim, not redrawn — decision in
 * `DispatchRouteScanSessionTablet`'s own header), órdenes/paradas/en el
 * andén, rejections, últimas lecturas and órdenes incompletas. Decision 5
 * (no page scroll): this column scrolls internally
 * (`overflow-y-auto` on the wrapper below, not on `body`), the parent
 * layout fixes its height.
 */
export function DispatchTabletSidePanel({
  vehicleExternalId,
  driverName,
  packagesLoaded,
  vehicleCapacityPackages,
  ordersCount,
  stopsCount,
  pendingOnDock,
  rejectionCount,
  rejectionTally,
  history,
  incompleteOrders,
  orderBoxCounts,
}: DispatchTabletSidePanelProps) {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l-[1.5px] border-border bg-surface">
      <RouteTrackingVehiclePanel
        vehicleExternalId={vehicleExternalId}
        driverName={driverName}
        packagesLoadedCount={packagesLoaded}
        vehicleCapacityPackages={vehicleCapacityPackages}
      />
      <div className="flex gap-2 px-5 py-3">
        <StatTile value={ordersCount} label="Órdenes" />
        <StatTile value={stopsCount} label="Paradas" />
        <StatTile value={pendingOnDock} label="En el andén" />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3" data-testid="dispatch-tablet-side-scroll">
        <div className="flex flex-col gap-4">
          <DispatchScanRejectionSummary rejectionCount={rejectionCount} tally={rejectionTally} />
          <DispatchTabletIncompleteOrders orders={incompleteOrders} boxCounts={orderBoxCounts} />
          <DispatchScanHistoryList entries={history} />
        </div>
      </div>
    </div>
  );
}
