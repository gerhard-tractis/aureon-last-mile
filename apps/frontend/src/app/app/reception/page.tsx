'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QrCode, Package, Truck, CheckCircle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { ReceptionCard } from '@/components/reception/ReceptionCard';
import { QRScanner } from '@/components/reception/QRScanner';
import { useReceptionManifests } from '@/hooks/reception/useReceptionManifests';
import { useCompletedReceptions } from '@/hooks/reception/useCompletedReceptions';
import { useOperatorId } from '@/hooks/useOperatorId';
import type { ReceptionManifest } from '@/hooks/reception/useReceptionManifests';

function isToday(dateString: string | null): boolean {
  if (!dateString) return false;
  const d = new Date(dateString);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export default function ReceptionPage() {
  const { operatorId } = useOperatorId();
  const router = useRouter();
  const { data: activeManifests = [], isLoading: isLoadingActive } = useReceptionManifests(operatorId);
  const { data: completedManifests = [], isLoading: isLoadingCompleted } = useCompletedReceptions(operatorId);
  const [showScanner, setShowScanner] = useState(false);

  const awaitingCount = activeManifests.filter(
    (m) => m.reception_status === 'awaiting_reception'
  ).length;
  const inProgressCount = activeManifests.filter(
    (m) => m.reception_status === 'reception_in_progress'
  ).length;
  const completedTodayCount = completedManifests.filter((m) =>
    m.hub_receptions.some((r) => isToday((r as { completed_at?: string | null }).completed_at ?? null))
  ).length;
  const totalExpectedPackages = activeManifests.reduce(
    (sum, m) => sum + (m.total_packages ?? 0),
    0
  );

  const handleActiveCardClick = (manifest: ReceptionManifest) => {
    const activeReception = manifest.hub_receptions.find(
      (r) => r.status === 'in_progress' || r.status === 'pending'
    );
    if (activeReception) {
      router.push(`/app/reception/scan/${activeReception.id}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Recepción</h1>
        <Button onClick={() => setShowScanner(true)} className="flex items-center gap-2">
          <QrCode className="h-4 w-4" />
          Escanear QR
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="En tránsito" value={awaitingCount} icon={Truck} />
        <MetricCard label="En progreso" value={inProgressCount} icon={TrendingUp} />
        <MetricCard label="Completados hoy" value={completedTodayCount} icon={CheckCircle} />
        <MetricCard label="Paquetes esperados" value={totalExpectedPackages} icon={Package} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Activos</TabsTrigger>
          <TabsTrigger value="completed">Completados</TabsTrigger>
        </TabsList>

        {/* Active tab */}
        <TabsContent value="active" className="space-y-3 mt-4">
          {isLoadingActive ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : activeManifests.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin cargas pendientes"
              description="No hay cargas activas de recepción en este momento."
            />
          ) : (
            activeManifests.map((manifest) => {
              const isInProgress = manifest.reception_status === 'reception_in_progress';
              const inProgressReception = manifest.hub_receptions.find(
                (r) => r.status === 'in_progress'
              );
              const driverName =
                manifest.hub_receptions[0]?.delivered_by_user?.full_name ?? null;

              return (
                <ReceptionCard
                  key={manifest.id}
                  retailerName={manifest.retailer_name}
                  packageCount={manifest.total_packages ?? 0}
                  completedAt={manifest.completed_at}
                  receptionStatus={isInProgress ? 'reception_in_progress' : 'awaiting_reception'}
                  receivedCount={inProgressReception?.received_count}
                  expectedCount={inProgressReception?.expected_count}
                  driverName={driverName}
                  interactive={true}
                  onClick={() => handleActiveCardClick(manifest)}
                />
              );
            })
          )}
        </TabsContent>

        {/* Completed tab */}
        <TabsContent value="completed" className="space-y-3 mt-4">
          {isLoadingCompleted ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : completedManifests.length === 0 ? (
            <EmptyState
              icon={CheckCircle}
              title="Sin recepciones completadas"
              description="Las recepciones confirmadas aparecerán aquí."
            />
          ) : (
            completedManifests.map((manifest) => {
              const completedReception = manifest.hub_receptions.find(
                (r) => r.status === 'completed'
              );
              return (
                <ReceptionCard
                  key={manifest.id}
                  retailerName={manifest.retailer_name}
                  packageCount={manifest.total_packages ?? 0}
                  completedAt={
                    (completedReception as { completed_at?: string | null } | undefined)?.completed_at ??
                    manifest.completed_at
                  }
                  receptionStatus="awaiting_reception"
                  interactive={false}
                  onClick={() => {}}
                />
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* QR Scanner Dialog */}
      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent className="max-w-sm p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Escanear QR de manifiesto</DialogTitle>
          </DialogHeader>
          {showScanner && operatorId && (
            <QRScanner
              onClose={() => setShowScanner(false)}
              operatorId={operatorId}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
