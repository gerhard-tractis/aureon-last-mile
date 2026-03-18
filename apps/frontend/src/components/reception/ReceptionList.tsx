'use client';

import { useRouter } from 'next/navigation';
import { ReceptionCard } from './ReceptionCard';
import type { ReceptionManifest } from '@/hooks/reception/useReceptionManifests';

interface ReceptionListProps {
  manifests: ReceptionManifest[];
}

export function ReceptionList({ manifests }: ReceptionListProps) {
  const router = useRouter();

  if (manifests.length === 0) {
    return (
      <p className="text-gray-500 text-center py-8">
        No hay cargas pendientes de recepción
      </p>
    );
  }

  const handleCardClick = (manifest: ReceptionManifest) => {
    const inProgressReception = manifest.hub_receptions.find(
      (r) => r.status === 'in_progress'
    );
    if (inProgressReception) {
      router.push(`/app/reception/scan/${inProgressReception.id}`);
    }
    // For awaiting_reception, the user should use the QR scanner
  };

  return (
    <div className="space-y-3">
      {manifests.map((manifest) => {
        const inProgressReception = manifest.hub_receptions.find(
          (r) => r.status === 'in_progress'
        );

        return (
          <ReceptionCard
            key={manifest.id}
            retailerName={manifest.retailer_name}
            packageCount={manifest.total_packages ?? 0}
            completedAt={manifest.completed_at}
            receptionStatus={
              manifest.reception_status === 'reception_in_progress'
                ? 'reception_in_progress'
                : 'awaiting_reception'
            }
            receivedCount={inProgressReception?.received_count}
            expectedCount={inProgressReception?.expected_count}
            onClick={() => handleCardClick(manifest)}
          />
        );
      })}
    </div>
  );
}
