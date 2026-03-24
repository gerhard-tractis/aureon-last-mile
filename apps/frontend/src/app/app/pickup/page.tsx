'use client';

import { Suspense, useState, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Camera } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ManifestCard } from '@/components/pickup/ManifestCard';
import { ClientFilter } from '@/components/pickup/ClientFilter';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { usePendingManifests, useCompletedManifests } from '@/hooks/pickup/useManifests';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';

// ── Inner component — uses useSearchParams, so must be inside Suspense ────────
function PickupPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [intakeOpen, setIntakeOpen] = useState(false);

  const selectedClient = searchParams.get('client');

  const setSelectedClient = (client: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (client) {
      params.set('client', client);
    } else {
      params.delete('client');
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: pendingManifests, isLoading: pendingLoading } = usePendingManifests(operatorId);
  const { data: completedManifests, isLoading: completedLoading } = useCompletedManifests(
    activeTab === 'completed' ? operatorId : null
  );

  // Distinct retailer names from pending manifests (client-side, no new RPC)
  const clients = useMemo(() => {
    const names = (pendingManifests ?? [])
      .map((m) => m.retailer_name)
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)];
  }, [pendingManifests]);

  const filteredPending = useMemo(
    () =>
      selectedClient
        ? (pendingManifests ?? []).filter((m) => m.retailer_name === selectedClient)
        : (pendingManifests ?? []),
    [pendingManifests, selectedClient]
  );

  const filteredCompleted = useMemo(
    () =>
      selectedClient
        ? (completedManifests ?? []).filter((m) => m.retailer_name === selectedClient)
        : (completedManifests ?? []),
    [completedManifests, selectedClient]
  );

  const handleManifestClick = async (
    externalLoadId: string,
    retailerName: string | null,
    orderCount: number,
    packageCount: number
  ) => {
    const supabase = createSPAClient();

    const { data: existing } = await supabase
      .from('manifests')
      .select('id')
      .eq('operator_id', operatorId!)
      .eq('external_load_id', externalLoadId)
      .is('deleted_at', null)
      .limit(1);

    if (!existing || existing.length === 0) {
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Pickup</h1>
        <button
          onClick={() => setIntakeOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-accent text-white rounded-lg text-sm font-medium"
        >
          <Camera className="h-4 w-4" />
          {t('pickup.nuevo_manifiesto')}
        </button>
      </div>

      {/* Client filter */}
      {clients.length > 0 && (
        <ClientFilter
          clients={clients}
          selected={selectedClient}
          onSelect={setSelectedClient}
        />
      )}

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
          ) : filteredPending.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No pending manifests</p>
          ) : (
            filteredPending.map((m) => (
              <ManifestCard
                key={m.external_load_id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                orderCount={m.order_count}
                packageCount={m.package_count}
                onClick={() =>
                  handleManifestClick(m.external_load_id, m.retailer_name, m.order_count, m.package_count)
                }
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
          ) : filteredCompleted.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No completed manifests</p>
          ) : (
            filteredCompleted.map((m) => (
              <ManifestCard
                key={m.id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                orderCount={m.total_orders ?? 0}
                packageCount={m.total_packages ?? 0}
                completedAt={m.completed_at}
                onClick={() => {}}
              />
            ))
          )}
        </div>
      )}

      {/* Camera Intake Modal */}
      {intakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-background rounded-xl p-6 shadow-xl border border-border">
            <h2 className="text-lg font-semibold text-text mb-4">{t('pickup.nuevo_manifiesto')}</h2>
            <CameraIntake onClose={() => setIntakeOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page shell — wraps content in Suspense (required for useSearchParams) ─────
export default function PickupPage() {
  return (
    <Suspense fallback={null}>
      <PickupPageContent />
    </Suspense>
  );
}
