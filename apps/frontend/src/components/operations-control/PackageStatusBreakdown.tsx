'use client';

/**
 * PackageStatusBreakdown
 * Renders a table of per-package statuses inside the order detail modal.
 */

import type { PackageDetail } from '@/hooks/useOrderDetail';
import { StatusBadge } from '@/components/StatusBadge';

interface PackageStatusBreakdownProps {
  packages: PackageDetail[];
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return '—';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

export function PackageStatusBreakdown({ packages }: PackageStatusBreakdownProps) {
  if (packages.length === 0) {
    return (
      <p className="text-sm text-text-muted py-2">No hay paquetes registrados</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Número</th>
            <th className="px-2 py-2 font-medium">Estado</th>
            <th className="px-2 py-2 font-medium">Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
              <tr key={pkg.id} className="border-b border-border-subtle">
                <td className="px-2 py-2 font-mono text-xs">{pkg.label}</td>
                <td className="px-2 py-2">{pkg.package_number ?? '—'}</td>
                <td className="px-2 py-2">
                  <span data-testid={`pkg-status-badge-${pkg.id}`}>
                    <StatusBadge
                      status={pkg.status ?? 'pending'}
                      size="sm"
                    />
                  </span>
                </td>
                <td className="px-2 py-2 text-text-muted text-xs">{timeAgo(pkg.status_updated_at)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
