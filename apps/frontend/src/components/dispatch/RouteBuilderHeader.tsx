'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import type { RouteStatus } from '@/lib/dispatch/types';
import type { BadgeVariant } from '@/components/StatusBadge';
import { formatRouteHeaderDate } from '@/lib/utils/dateFormat';

interface Props {
  routeId: string;
  routeDate: string | undefined;
  routeStatus: RouteStatus | undefined;
  statusConfig: { label: string; variant: BadgeVariant } | undefined;
  pendingCount: number;
  packageCount: number;
  onBack: () => void;
}

/**
 * spec-75 phase 4 — split out of `RouteBuilder.tsx` (364 lines, over the
 * 300-line budget). Header/status seam: back button, route code, date,
 * status badge, and the "Órdenes en la ruta" count bar (spec-70 phase 4
 * breakage #8 — these rows are orders planned/staged onto the route, not
 * scanned packages).
 */
export function RouteBuilderHeader({
  routeId,
  routeDate,
  routeStatus,
  statusConfig,
  pendingCount,
  packageCount,
  onBack,
}: Props) {
  return (
    <>
      <div className="shrink-0 flex items-center gap-3 px-5 h-14 bg-surface border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack} className="text-text-muted">
          <ArrowLeft />
        </Button>
        <span className="font-mono text-[15px] font-bold text-accent">
          {routeId.slice(0, 8).toUpperCase()}
        </span>
        {/* QA finding #1: this rendered today's date via `new Date()`, not
            the route's own — a route dated 2026-08-26 showed "jue, 27 ago".
            `route` is still undefined on first paint, so show nothing
            rather than guess; a wrong date is worse than a blank one. */}
        {routeDate && <span className="text-xs text-text-muted">{formatRouteHeaderDate(routeDate)}</span>}
        {statusConfig && (
          <StatusBadge status={routeStatus!} label={statusConfig.label} variant={statusConfig.variant} size="sm" />
        )}
      </div>

      <div className="shrink-0 flex items-center justify-between px-5 h-9 bg-background border-b border-border">
        <span className="text-[11px] text-text-muted uppercase tracking-[0.06em]">Órdenes en la ruta</span>
        <span className="flex items-center gap-3">
          {pendingCount > 0 && (
            // spec-74 phase 4 review item 4. This bar counts orders
            // (packageCount, next to it) but this banner counts outstanding
            // BOXES — a different unit sharing one row. Naming the unit
            // here disambiguates the two.
            <span className="text-[11px] font-semibold text-status-warning-text">
              Faltan {pendingCount} bulto{pendingCount === 1 ? '' : 's'} por estibar
            </span>
          )}
          <strong className="font-mono text-[13px] text-accent">{packageCount}</strong>
        </span>
      </div>
    </>
  );
}
