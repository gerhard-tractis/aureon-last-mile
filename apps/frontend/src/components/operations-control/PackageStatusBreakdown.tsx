'use client';

/**
 * PackageStatusBreakdown
 * Renders a table of per-package statuses inside the order detail modal.
 */

import { Printer } from 'lucide-react';
import type { PackageDetail } from '@/hooks/useOrderDetail';
import { StatusBadge } from '@/components/StatusBadge';

interface PackageStatusBreakdownProps {
  packages: PackageDetail[];
  /** spec-53 — the manifest these packages belong to. NULL hides the reprint
   * icon: either the order has no external_load_id, or no manifest row exists yet. */
  manifestId?: string | null;
  /** spec-53 — PACKAGE_LABELS module gate. Icon is absent entirely when false. */
  labelsEnabled?: boolean;
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

export function PackageStatusBreakdown({ packages, manifestId = null, labelsEnabled = false }: PackageStatusBreakdownProps) {
  if (packages.length === 0) {
    return (
      <p className="text-sm text-text-muted py-2">No hay paquetes registrados</p>
    );
  }

  const showReprint = labelsEnabled && !!manifestId;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted uppercase">
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Número</th>
            <th className="px-2 py-2 font-medium">Estado</th>
            <th className="px-2 py-2 font-medium">Actualizado</th>
            {showReprint && <th className="px-2 py-2 font-medium" />}
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
                {showReprint && (
                  <td className="px-2 py-2 text-right">
                    <a
                      href={`/app/pickup/manifests/${manifestId}/labels/print?packageId=${pkg.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Reimprimir etiqueta de ${pkg.label}`}
                      className="inline-flex text-text-secondary hover:text-accent"
                    >
                      <Printer className="h-4 w-4" />
                    </a>
                  </td>
                )}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
