'use client';
import { Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ManualAssignMenu } from './ManualAssignMenu';
import type { DockZone } from '@/lib/distribution/sectorization-engine';
import type { ZoneGroup, PendingPackage } from '@/hooks/distribution/usePendingSectorization';

interface PendingDockListProps {
  groups: ZoneGroup[];
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
}

export function PendingDockList({
  groups,
  verifiedPackageIds,
  onTapVerify,
  onManualAssign,
  activeZones,
}: PendingDockListProps) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No hay paquetes pendientes en este momento.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <PendingDockListGroup
          key={group.zone.id}
          group={group}
          verifiedPackageIds={verifiedPackageIds}
          onTapVerify={onTapVerify}
          onManualAssign={onManualAssign}
          activeZones={activeZones}
        />
      ))}
    </div>
  );
}

interface PendingDockListGroupProps {
  group: ZoneGroup;
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
}

function PendingDockListGroup({
  group,
  verifiedPackageIds,
  onTapVerify,
  onManualAssign,
  activeZones,
}: PendingDockListGroupProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-baseline gap-2">
          <span>{group.zone.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {group.zone.code}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {group.packages.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {group.packages.map(pkg => (
          <PendingDockListRow
            key={pkg.id}
            pkg={pkg}
            zoneCode={group.zone.code}
            verified={verifiedPackageIds.has(pkg.id)}
            onTapVerify={onTapVerify}
            onManualAssign={onManualAssign}
            activeZones={activeZones}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface PendingDockListRowProps {
  pkg: PendingPackage;
  zoneCode: string;
  verified: boolean;
  onTapVerify: (packageId: string) => void;
  onManualAssign?: (packageId: string, zoneId: string) => void;
  activeZones: DockZone[];
}

function PendingDockListRow({
  pkg,
  zoneCode,
  verified,
  onTapVerify,
  onManualAssign,
  activeZones,
}: PendingDockListRowProps) {
  const handleClick = () => {
    if (verified) return;
    onTapVerify(pkg.id);
  };

  return (
    <div
      data-testid={`pending-row-${pkg.id}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`flex items-center gap-2 px-2 py-2 rounded border ${
        verified
          ? 'bg-status-success-bg border-status-success-border'
          : 'border-transparent hover:bg-accent cursor-pointer'
      }`}
    >
      {verified && (
        <Check
          data-testid="verified-check"
          className="h-4 w-4 text-status-success shrink-0"
        />
      )}
      <span className="font-mono text-sm">{pkg.label}</span>
      <span className="text-xs text-muted-foreground ml-auto font-mono">
        {zoneCode}
      </span>
      {onManualAssign && (
        <div onClick={e => e.stopPropagation()}>
          <ManualAssignMenu
            packageId={pkg.id}
            activeZones={activeZones}
            onSelect={zoneId => onManualAssign(pkg.id, zoneId)}
          />
        </div>
      )}
    </div>
  );
}
