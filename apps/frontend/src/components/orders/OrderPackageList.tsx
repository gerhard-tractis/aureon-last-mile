import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { formatDurationSince } from '@/lib/orders/duration';
import type { DossierPackage } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 7 — one row per package. `retenido` is the "blocking" status:
 * a package that kept the order from going out complete, so it gets the
 * warning palette and its held duration, matching `1f`'s CL…005 row.
 */
interface Props {
  packages: DossierPackage[];
  now?: Date;
}

function formatWeight(pkg: DossierPackage): string | null {
  const kg = pkg.verified_weight_kg ?? pkg.declared_weight_kg;
  if (kg === null || kg === undefined) return null;
  return `${kg.toLocaleString('es-CL')} kg`;
}

export function OrderPackageList({ packages, now = new Date() }: Props) {
  return (
    <ul className="flex flex-col gap-2" data-testid="order-package-list">
      {packages.map((pkg) => {
        const blocking = pkg.status === 'retenido';
        const weight = formatWeight(pkg);
        const meta = [pkg.dock_zone_name, weight].filter((v): v is string => Boolean(v));
        const heldDuration =
          blocking && pkg.status_updated_at ? formatDurationSince(pkg.status_updated_at, now) : null;

        return (
          <li
            key={pkg.id}
            data-testid={`package-row-${pkg.id}`}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3.5 py-3',
              blocking ? 'border-status-warning-border bg-status-warning-bg' : 'border-border',
            )}
          >
            <span className="font-mono text-[11.5px] font-semibold text-text">{pkg.label}</span>
            <StatusBadge status={pkg.status ?? ''} kind="package" size="sm" />
            <span
              className={cn(
                'ml-auto text-[11px]',
                blocking ? 'text-status-warning-text' : 'text-text-muted',
              )}
            >
              {heldDuration && <span data-testid={`held-duration-${pkg.id}`}>retenido {heldDuration}</span>}
              {heldDuration && meta.length > 0 && ' · '}
              {meta.length > 0 && (
                <span data-testid={`package-meta-${pkg.id}`}>{meta.join(' · ')}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
