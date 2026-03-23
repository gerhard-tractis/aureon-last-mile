'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ManifestCard } from '@/components/pickup/ManifestCard';
import { usePendingManifests, useCompletedManifests } from '@/hooks/pickup/useManifests';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';

export default function PickupPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  const { data: pendingManifests, isLoading: pendingLoading } = usePendingManifests(operatorId);
  const { data: completedManifests, isLoading: completedLoading } = useCompletedManifests(
    activeTab === 'completed' ? operatorId : null
  );

  const handleManifestClick = async (
    externalLoadId: string,
    retailerName: string | null,
    orderCount: number,
    packageCount: number
  ) => {
    const supabase = createSPAClient();

    // Check if manifest already exists
    const { data: existing } = await supabase
      .from('manifests')
      .select('id')
      .eq('operator_id', operatorId!)
      .eq('external_load_id', externalLoadId)
      .is('deleted_at', null)
      .limit(1);

    if (!existing || existing.length === 0) {
      // Create new manifest
      const { error } = await supabase.from('manifests').insert({
        operator_id: operatorId!,
        external_load_id: externalLoadId,
        retailer_name: retailerName,
        total_orders: orderCount,
        total_packages: packageCount,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });
      if (error) {
        console.error('Failed to create manifest:', error);
        return;
      }
    }

    router.push(`/app/pickup/scan/${encodeURIComponent(externalLoadId)}`);
  };

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold text-text">Pickup</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'active'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'completed'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text'
          }`}
        >
          Completed
        </button>
      </div>

      {/* Active Tab */}
      {activeTab === 'active' && (
        <div className="space-y-3">
          {pendingLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))
          ) : pendingManifests?.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No pending manifests</p>
          ) : (
            pendingManifests?.map((m) => (
              <ManifestCard
                key={m.external_load_id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                orderCount={m.order_count}
                packageCount={m.package_count}
                onClick={() => handleManifestClick(
                  m.external_load_id, m.retailer_name, m.order_count, m.package_count
                )}
              />
            ))
          )}
        </div>
      )}

      {/* Completed Tab */}
      {activeTab === 'completed' && (
        <div className="space-y-3">
          {completedLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))
          ) : completedManifests?.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No completed manifests</p>
          ) : (
            completedManifests?.map((m) => (
              <ManifestCard
                key={m.id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                orderCount={m.total_orders ?? 0}
                packageCount={m.total_packages ?? 0}
                completedAt={m.completed_at}
                onClick={() => {}} // Completed manifests are read-only
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
