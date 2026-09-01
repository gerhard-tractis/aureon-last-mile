import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import type { RoutePackage } from '@/lib/dispatch/types';

interface Props {
  index: number;
  pkg: RoutePackage;
  onRemove: (dispatchId: string) => void;
}

export function PackageRow({ index, pkg, onRemove }: Props) {
  // spec-70 decision 4: the gap between the plan and the load has to be
  // visible on the row while loading is still happening — the seal refusal
  // is the worst possible moment to find out a stop was never scanned.
  //
  // spec-74 phase 3 widened this to also cover `partially_staged` — some
  // but not all of this order's bultos are loaded, which still means it is
  // not safe to seal (seal-route.ts's widened UNSEALED_STOPS). Both states
  // keep the warning border below; phase 4 gives them distinct copy.
  //
  // spec-74 phase 4 review item 1 (BLOCKER). `adopted` was missing here
  // entirely, so a 3-bulto order adopted via the route-level scan with one
  // box scanned rendered identically to a fully staged stop — no border, no
  // copy — while seal-route.ts refuses it (an `adopted` row's `stage` is
  // never rewritten as its packages load; see seal-route.ts's own comment).
  // `boxesLoaded < boxesTotal` is the same predicate the seal itself checks
  // for an adopted order's completeness (useRoutePackages.ts pre-filters
  // both counts to the seal's DISPATCHABLE_STATUSES already), so an
  // `adopted` row only shows the warning when it is genuinely outstanding —
  // unlike `planned`/`partially_staged`, which are never "complete" states.
  const adoptedOutstanding = pkg.stage === 'adopted' && pkg.boxesLoaded < pkg.boxesTotal;
  const unstaged = pkg.stage === 'planned' || pkg.stage === 'partially_staged' || adoptedOutstanding;
  // spec-74 phase 4. A fully-unstaged order (0 of N loaded) and a
  // half-loaded one are different operational facts — spec-74 Decision 2's
  // whole point is that a supervisor has to be able to tell "nothing
  // scanned" from "some bultos on the truck, some still on the andén"
  // instead of both collapsing into one "Sin estibar" warning. An
  // outstanding `adopted` row gets the same per-bulto copy once at least
  // one of its boxes has actually been scanned.
  const isPartial = pkg.stage === 'partially_staged' || (adoptedOutstanding && pkg.boxesLoaded > 0);

  return (
    <div
      className={`flex items-center gap-3.5 bg-surface border rounded-[10px] px-3.5 min-h-[60px] mb-2 ${
        unstaged ? 'border-status-warning' : 'border-border'
      }`}
    >
      <span className="font-mono text-[11px] text-text-muted w-5.5 text-right shrink-0">
        {index}
      </span>
      <div className="flex-1 min-w-0 py-2">
        <div className="font-mono text-[11px] text-accent">
          {pkg.order_number}
        </div>
        <div className="text-sm font-semibold text-text">
          {pkg.contact_name ?? '—'}
        </div>
        <div className="text-xs text-text-muted truncate">
          {pkg.contact_address ?? '—'}
        </div>
        {isPartial ? (
          <div className="text-[11px] font-semibold text-status-warning-text mt-0.5">
            {/* spec-74 phase 4 review item 7: every sibling screen names the
                unit ("N bultos") — ConsolidationPageContent.tsx:196,
                PendingDockListOrderGroup.tsx:50. This elided it. */}
            {pkg.boxesLoaded} de {pkg.boxesTotal} bultos estibados
          </div>
        ) : (
          unstaged && (
            <div className="text-[11px] font-semibold text-status-warning-text mt-0.5">
              Sin estibar
            </div>
          )
        )}
      </div>
      {/*
        kind="dispatch": pkg.status is dispatches.status (dispatch_status_enum),
        the provider's delivery outcome — not a package status. This used to
        render under kind="package" from a field literally named
        `package_status`, so 'partial' (a real value here, not a
        PackageStatus at all) fell back to the raw string. See
        RoutePackage.status in lib/dispatch/types.ts.
      */}
      <StatusBadge
        status={pkg.status}
        kind="dispatch"
        size="sm"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(pkg.dispatch_id)}
        aria-label="Eliminar paquete"
        className="text-text-muted shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
