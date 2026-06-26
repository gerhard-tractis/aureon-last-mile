'use client';

import { useState } from 'react';
import { QrCode, Package, Truck, CheckCircle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MetricCard } from '@/components/metrics/MetricCard';
import { IncomingRoutesList } from '@/components/reception/IncomingRoutesList';
import { RouteQRScannerEntry } from '@/components/reception/RouteQRScannerEntry';
import { useIncomingRoutes } from '@/hooks/reception/useIncomingRoutes';
import { useOperatorId } from '@/hooks/useOperatorId';
import { ReturnRouteList } from './ReturnRouteList';
import { ReturnReceptionSession } from './ReturnReceptionSession';

export default function ReceptionPage() {
  const { operatorId } = useOperatorId();
  const { data: incomingRoutes = [], isLoading: isLoadingIncoming } = useIncomingRoutes(
    operatorId,
    'in_transit',
  );
  const { data: completedRoutes = [], isLoading: isLoadingCompleted } = useIncomingRoutes(
    operatorId,
    'received',
  );
  const [showScanner, setShowScanner] = useState(false);
  const [selectedReturnRoute, setSelectedReturnRoute] = useState<string | null>(null);

  const incomingCount = incomingRoutes.length;
  const completedCount = completedRoutes.length;
  const totalExpected = incomingRoutes.reduce((s, r) => s + r.expected_packages, 0);

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
        <MetricCard label="Rutas entrantes" value={incomingCount} icon={Truck} />
        <MetricCard label="Paquetes esperados" value={totalExpected} icon={Package} />
        <MetricCard label="Completadas" value={completedCount} icon={CheckCircle} />
        <MetricCard label="En curso" value={0} icon={TrendingUp} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">Rutas entrantes</TabsTrigger>
          <TabsTrigger value="completed">Completadas</TabsTrigger>
          <TabsTrigger value="retornos">Retornos</TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="space-y-3 mt-4">
          {isLoadingIncoming ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <IncomingRoutesList routes={incomingRoutes} />
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-3 mt-4">
          {isLoadingCompleted ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <IncomingRoutesList routes={completedRoutes} />
          )}
        </TabsContent>

        <TabsContent value="retornos" className="mt-4">
          {selectedReturnRoute ? (
            <ReturnReceptionSession
              operatorId={operatorId}
              externalRouteId={selectedReturnRoute}
              onBack={() => setSelectedReturnRoute(null)}
            />
          ) : (
            <ReturnRouteList
              operatorId={operatorId}
              onSelectRoute={setSelectedReturnRoute}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* QR Scanner Dialog */}
      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent className="max-w-sm p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Escanear QR de ruta</DialogTitle>
          </DialogHeader>
          {showScanner && operatorId && (
            <RouteQRScannerEntry
              operatorId={operatorId}
              onResolved={() => setShowScanner(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
