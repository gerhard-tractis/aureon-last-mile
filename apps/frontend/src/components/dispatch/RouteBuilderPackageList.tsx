'use client';

import { PackageRow } from './PackageRow';
import { RouteBlockList } from './RouteBlockList';
import { TopupSuggestions } from './TopupSuggestions';
import { VehicleCapacityBar } from './VehicleCapacityBar';
import type { VehicleFillStatus } from '@/lib/dispatch/vehicle-capacity';
import type { RoutePackage, RouteStatus } from '@/lib/dispatch/types';

interface Props {
  routeId: string;
  operatorId: string;
  routeStatus: RouteStatus | undefined;
  role: string | null | undefined;
  vehicleFillStatus: VehicleFillStatus;
  sealError: string | null;
  removeError: string | null;
  packages: RoutePackage[];
  onRemove: (dispatchId: string) => void;
}

/**
 * spec-75 phase 4 — split out of `RouteBuilder.tsx`. Package-list seam:
 * the block sequence, the vehicle fill bar, top-up suggestions, the seal
 * and remove error banners, and the package rows themselves.
 */
export function RouteBuilderPackageList({
  routeId,
  operatorId,
  routeStatus,
  role,
  vehicleFillStatus,
  sealError,
  removeError,
  packages,
  onRemove,
}: Props) {
  return (
    <>
      <RouteBlockList routeId={routeId} operatorId={operatorId} routeStatus={routeStatus} />

      {/* spec-73 phase 4c — the fill bar phase 4b's TopupSuggestions was
          placed next to but never wired. Answers "why would you [top up]?"
          immediately above the suggestions that answer "which block
          could you". Renders nothing until a vehicle is selected and that
          vehicle has a configured capacity_packages — see
          VehicleCapacityBar's own render-nothing contract, preserved here
          by construction (vehicleFillStatus computed by the caller). */}
      <VehicleCapacityBar status={vehicleFillStatus} className="px-5 py-2" />

      {/* spec-73 phase 4b — sits directly below the block sequence, above
          the package list, next to the under-fill signal (Decision 1's
          fill bar, wired in phase 4c immediately above) that motivates it.
          Renders nothing when there is nothing eligible to suggest — see
          the component's own render-nothing contract. */}
      <TopupSuggestions routeId={routeId} operatorId={operatorId} role={role} />

      {sealError && (
        <div className="shrink-0 bg-status-error-bg border-b border-status-error-border text-status-error px-5 py-2.5 text-xs">
          ⚠ {sealError}
        </div>
      )}

      {removeError && (
        <div className="shrink-0 bg-status-error-bg border-b border-status-error-border text-status-error px-5 py-2.5 text-xs">
          ⚠ {removeError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {packages.map((pkg, i) => (
          <PackageRow key={pkg.dispatch_id} index={i + 1} pkg={pkg} onRemove={onRemove} />
        ))}
      </div>
    </>
  );
}
