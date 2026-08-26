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
  const unstaged = pkg.stage === 'planned';

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
        {unstaged && (
          <div className="text-[11px] font-semibold text-status-warning-text mt-0.5">
            Sin estibar
          </div>
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
