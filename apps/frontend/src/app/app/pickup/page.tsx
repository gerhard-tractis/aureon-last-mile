'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ManifestCard } from '@/components/pickup/ManifestCard';
import { usePendingManifests, useCompletedManifests } from '@/hooks/pickup/useManifests';
import { useOperatorId } from '@/hooks/useDashboardMetrics';
import { hasPermission } from '@/lib/types/auth.types';
import { createSPAClient } from '@/lib/supabase/client';

export default function PickupPage() {
  const router = useRouter();
  const { operatorId, permissions } = useOperatorId();
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  // Permission guard
  useEffect(() => {
    if (permissions.length > 0 && !hasPermission(permissions, 'pickup')) {
      router.push('/app');
    }
  }, [permissions, router]);

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
    // Upsert manifest record (create if not exists)
    const supabase = createSPAClient();
    const { error } = await supabase
      .from('manifests')
      .upsert(
        {
          operator_id: operatorId!,
          external_load_id: externalLoadId,
          retailer_name: retailerName,
          total_orders: orderCount,
          total_packages: packageCount,
          status: 'in_progress' as const,
          started_at: new Date().toISOString(),
        },
        { onConflict: 'operator_id,external_load_id' }
      );
    if (error) {
      console.error('Failed to upsert manifest:', error);
      return;
    }
    router.push(`/app/pickup/scan/${encodeURIComponent(externalLoadId)}`);
  };

  if (permissions.length > 0 && !hasPermission(permissions, 'pickup')) {
    return null;
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold text-gray-900">Pickup Verification</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'active'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'completed'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
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
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : pendingManifests?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No pending manifests</p>
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
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          ) : completedManifests?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No completed manifests</p>
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
