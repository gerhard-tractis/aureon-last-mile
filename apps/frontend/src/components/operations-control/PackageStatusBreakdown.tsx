'use client';

/**
 * PackageStatusBreakdown
 * Renders a table of per-package statuses inside the order detail modal.
 */

import type { PackageDetail } from '@/hooks/useOrderDetail';

interface PackageStatusBreakdownProps {
  packages: PackageDetail[];
}

const STATUS_COLORS: Record<string, string> = {
  ingresado: 'bg-gray-100 text-gray-700',
  verificado: 'bg-blue-100 text-blue-700',
  en_bodega: 'bg-purple-100 text-purple-700',
  asignado: 'bg-indigo-100 text-indigo-700',
  en_carga: 'bg-orange-100 text-orange-700',
  listo: 'bg-cyan-100 text-cyan-700',
  en_ruta: 'bg-yellow-100 text-yellow-700',
  entregado: 'bg-green-100 text-green-700',
  cancelado: 'bg-red-100 text-red-700',
};

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
      <p className="text-sm text-gray-500 py-2">No hay paquetes registrados</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
            <th className="px-2 py-2 font-medium">Label</th>
            <th className="px-2 py-2 font-medium">Número</th>
            <th className="px-2 py-2 font-medium">Estado</th>
            <th className="px-2 py-2 font-medium">Actualizado</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => {
            const statusColor = pkg.status
              ? (STATUS_COLORS[pkg.status] ?? 'bg-gray-100 text-gray-700')
              : 'bg-gray-100 text-gray-500';

            return (
              <tr key={pkg.id} className="border-b border-gray-100">
                <td className="px-2 py-2 font-mono text-xs">{pkg.label}</td>
                <td className="px-2 py-2">{pkg.package_number ?? '—'}</td>
                <td className="px-2 py-2">
                  <span
                    data-testid={`pkg-status-badge-${pkg.id}`}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}
                  >
                    {pkg.status ?? 'Sin estado'}
                  </span>
                </td>
                <td className="px-2 py-2 text-gray-500 text-xs">{timeAgo(pkg.status_updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
