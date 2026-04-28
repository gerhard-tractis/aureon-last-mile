'use client';

import { Suspense, useState, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Camera, ClipboardList, Package, CheckCircle, Search, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { ManifestCard } from '@/components/pickup/ManifestCard';
import { ClientFilter } from '@/components/pickup/ClientFilter';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { usePendingManifests, useCompletedManifests, useInTransitManifests } from '@/hooks/pickup/useManifests';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  const [activeTab, setActiveTab] = useState<'active' | 'in_transit' | 'completed'>('active');
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedClient = searchParams.get('client');

  // Match against load id, retailer name, and pickup point. Case-insensitive substring.
  const matchesSearch = (m: { external_load_id: string; retailer_name: string | null; pickup_point: string | null }) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      m.external_load_id.toLowerCase().includes(q) ||
      (m.retailer_name?.toLowerCase().includes(q) ?? false) ||
      (m.pickup_point?.toLowerCase().includes(q) ?? false)
    );
  };

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

  const filteredPending = useMemo(
    () => (pendingManifests ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // matchesSearch is recomputed each render but only its inputs (searchTerm) need
    // to be in the dep list — eslint-disable for the closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingManifests, selectedClient, searchTerm],
  );

  const filteredCompleted = useMemo(
    () => (completedManifests ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedManifests, selectedClient, searchTerm],
  );

  const filteredInTransit = useMemo(
    () => (inTransitManifests ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inTransitManifests, selectedClient, searchTerm],
  );

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
      .from('manifests').select('id')
      .eq('operator_id', operatorId!)
      .eq('external_load_id', externalLoadId)
      .is('deleted_at', null).limit(1);

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
      if (error) { console.error('Failed to create manifest:', error); return; }
    }
    router.push(`/app/pickup/scan/${encodeURIComponent(externalLoadId)}`);
  };

  // En tránsito tab: the manifest row already exists (it was created during
  // the original scan flow and now has reception_status set), so skip the
  // upsert and route straight to the handoff page. The handoff page detects
  // reception_status on load and short-circuits to the QR view.
  const handleInTransitClick = (externalLoadId: string) => {
    router.push(`/app/pickup/handoff/${encodeURIComponent(externalLoadId)}`);
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'active' | 'in_transit' | 'completed')}>
        <TabsList>
          <TabsTrigger value="active">Activos</TabsTrigger>
          <TabsTrigger value="in_transit">En tránsito</TabsTrigger>
          <TabsTrigger value="completed">Completados</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <div className="space-y-3">
            {pendingLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
              ))
            ) : filteredPending.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Sin manifiestos pendientes"
                description="Los manifiestos asignados aparecerán aquí."
              />
            ) : (
              filteredPending.map((m) => (
                <ManifestCard
                  key={m.external_load_id}
                  externalLoadId={m.external_load_id}
                  retailerName={m.retailer_name}
                  pickupPoint={m.pickup_point}
                  orderCount={m.order_count}
                  packageCount={m.package_count}
                  createdAt={m.created_at}
                  onClick={() => handleManifestClick(
                    m.external_load_id, m.retailer_name, m.order_count, m.package_count,
                  )}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="in_transit">
          <div className="space-y-3">
            {inTransitLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
              ))
            ) : filteredInTransit.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Sin manifiestos en tránsito"
                description="Los manifiestos entregados a bodega aparecerán aquí."
              />
            ) : (
              filteredInTransit.map((m) => (
                <ManifestCard
                  key={m.id}
                  externalLoadId={m.external_load_id}
                  retailerName={m.retailer_name}
                  pickupPoint={m.pickup_point}
                  orderCount={m.total_orders ?? 0}
                  packageCount={m.total_packages ?? 0}
                  createdAt={m.created_at}
                  inTransit
                  onClick={() => handleInTransitClick(m.external_load_id)}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="completed">
          <div className="space-y-3">
            {completedLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
              ))
            ) : filteredCompleted.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Sin manifiestos completados"
                description="Los manifiestos finalizados aparecerán aquí."
              />
            ) : (
              filteredCompleted.map((m) => (
                <ManifestCard
                  key={m.id}
                  externalLoadId={m.external_load_id}
                  retailerName={m.retailer_name}
                  pickupPoint={m.pickup_point}
                  orderCount={m.total_orders ?? 0}
                  packageCount={m.total_packages ?? 0}
                  createdAt={m.created_at}
                  completedAt={m.completed_at}
                  interactive={false}
                  onClick={() => {}}
                />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

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
