'use client';

import { Suspense, useState, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Camera, ClipboardList, Package, CheckCircle, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { MetricCard } from '@/components/metrics/MetricCard';
import { ClientFilter } from '@/components/pickup/ClientFilter';
import { PickupManifestTabs } from '@/components/pickup/PickupManifestTabs';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { ActiveRouteBanner } from '@/components/pickup/ActiveRouteBanner';
import { StartRouteButton } from '@/components/pickup/StartRouteButton';
import { usePendingManifests, useCompletedManifests, useInTransitManifests } from '@/hooks/pickup/useManifests';
import { useActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import { useStartPickupRoute } from '@/hooks/pickup/useStartPickupRoute';
import { useRouteManifests } from '@/hooks/pickup/useRouteManifests';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { ModuleKey } from '@/lib/modules/registry';
import { createSPAClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { toast } from 'sonner';

// ── Helpers ──────────────────────────────────────────────────────────────────
function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// ── Inner component — uses useSearchParams, so must be inside Suspense ───────
function PickupPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const labelsEnabled = useModuleEnabled(operatorId, ModuleKey.PACKAGE_LABELS);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedClient = searchParams.get('client');

  const setSelectedClient = (client: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (client) params.set('client', client);
    else params.delete('client');
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: pendingManifests, isLoading: pendingLoading } =
    usePendingManifests(operatorId);
  const { data: inTransitManifests, isLoading: inTransitLoading } =
    useInTransitManifests(operatorId);
  const { data: completedManifests, isLoading: completedLoading } =
    useCompletedManifests(operatorId);

  // ── KPI computations ───────────────────────────────────────────────────────
  const pendingCount = (pendingManifests ?? []).length;
  const totalPackages = (pendingManifests ?? []).reduce(
    (sum, m) => sum + (m.package_count ?? 0), 0,
  );
  const completedToday = (completedManifests ?? []).filter(
    (m) => isToday(m.completed_at),
  ).length;

  // ── Client filter ──────────────────────────────────────────────────────────
  const clients = useMemo(() => {
    const names = (pendingManifests ?? [])
      .map((m) => m.retailer_name)
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)];
  }, [pendingManifests]);

  // The per-tab filtering by `selectedClient` + `searchTerm` lives in
  // PickupManifestTabs. The unfiltered pending list stays here because the KPI
  // cards above count it.

  // ── Manifest click handlers ────────────────────────────────────────────────
  // Active tab: ensure a manifest row exists for the load (creating one on
  // first scan), then navigate to the scan flow.
  const handleManifestClick = async (
    externalLoadId: string,
    retailerName: string | null,
    orderCount: number,
    packageCount: number,
  ) => {
    const supabase = createSPAClient();
    const { data: existing } = await supabase
      .from('manifests').select('id, status')
      .eq('operator_id', operatorId!)
      .eq('external_load_id', externalLoadId)
      .is('deleted_at', null).limit(1);

    if (!existing || existing.length === 0) {
      // Fallback only. Since 20260814000001 every CARGA gets a 'pending'
      // manifests row at ingest, so this branch should not fire in practice —
      // it covers rows created before that migration's backfill ran.
      const { error } = await supabase.from('manifests').insert({
        operator_id: operatorId!,
        external_load_id: externalLoadId,
        retailer_name: retailerName,
        total_orders: orderCount,
        total_packages: packageCount,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      });
      if (error) { console.error('Failed to create manifest:', error); return; }
    } else if (existing[0].status === 'pending') {
      // The row now pre-exists as 'pending'; opening the scan flow is what
      // makes it 'in_progress'. Without this the status would never advance
      // and the in-progress badge / verified-first sorting would go dead.
      const { error } = await supabase.from('manifests')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
          total_orders: orderCount,
          total_packages: packageCount,
        })
        .eq('id', existing[0].id);
      if (error) { console.error('Failed to start manifest:', error); return; }
    }
    router.push(`/app/pickup/scan/${encodeURIComponent(externalLoadId)}`);
  };

  // En tránsito tab: manifests here are now part of a closed pickup_route;
  // tapping a card jumps the driver into the active-route view so they can
  // re-show the QR. (Per spec-47 the QR is route-level, not manifest-level.)
  const handleInTransitClick = (_externalLoadId: string) => {
    router.push('/app/pickup/route/active');
  };

  // spec-53 — opens the label print route in a new tab so the executive keeps
  // the pickup screen open while the browser print dialog runs in the other.
  const handlePrintLabels = (manifestId: string) => {
    window.open(`/app/pickup/manifests/${manifestId}/labels/print`, '_blank');
  };

  // Active pickup route surfaced at the top of the landing.
  const { data: activeRoute } = useActivePickupRoute(operatorId);
  const { data: activeManifests = [] } = useRouteManifests(
    activeRoute?.id ?? null,
    operatorId,
  );
  const startMut = useStartPickupRoute(operatorId);
  const handleStartRoute = (vehicleId: string) => {
    startMut.mutate(
      { vehicleId },
      {
        onSuccess: () => router.push('/app/pickup/route/active'),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Recogida</h1>
        <Button onClick={() => setIntakeOpen(true)} className="gap-2">
          <Camera className="h-4 w-4" />
          {t('pickup.nuevo_manifiesto')}
        </Button>
      </div>

      {/* Active route banner / start button */}
      {activeRoute ? (
        <ActiveRouteBanner
          code={activeRoute.code}
          startedAt={activeRoute.started_at}
          manifestCount={activeManifests.length}
          routeId={activeRoute.id}
        />
      ) : (
        <StartRouteButton
          operatorId={operatorId}
          isSubmitting={startMut.isPending}
          onStart={handleStartRoute}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <MetricCard icon={ClipboardList} label="Manifiestos pendientes" value={pendingCount} />
        <MetricCard icon={Package} label="Paquetes totales" value={totalPackages} />
        <MetricCard icon={CheckCircle} label="Completados hoy" value={completedToday} />
      </div>

      {/* Client filter */}
      {clients.length > 0 && (
        <ClientFilter clients={clients} selected={selectedClient} onSelect={setSelectedClient} />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
        <Input
          type="search"
          placeholder="Buscar por carga, retailer o punto de recogida…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchTerm && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => setSearchTerm('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <PickupManifestTabs
        pending={pendingManifests}
        inTransit={inTransitManifests}
        completed={completedManifests}
        pendingLoading={pendingLoading}
        inTransitLoading={inTransitLoading}
        completedLoading={completedLoading}
        selectedClient={selectedClient}
        searchTerm={searchTerm}
        labelsEnabled={labelsEnabled}
        onManifestClick={handleManifestClick}
        onInTransitClick={handleInTransitClick}
        onPrintLabels={handlePrintLabels}
      />

      {/* Camera Intake Dialog */}
      <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('pickup.nuevo_manifiesto')}</DialogTitle>
          </DialogHeader>
          <CameraIntake onClose={() => setIntakeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page shell — wraps content in Suspense (required for useSearchParams) ────
export default function PickupPage() {
  return (
    <Suspense fallback={null}>
      <PickupPageContent />
    </Suspense>
  );
}
