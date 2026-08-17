'use client';

import { useMemo, useState } from 'react';
import { FileText, QrCode, ScanLine } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatTile } from '@/components/StatTile';
import { ArrivalsPanel } from '@/components/reception/ArrivalsPanel';
import { PendingResolutionPanel } from '@/components/reception/PendingResolutionPanel';
import { RouteQRScannerEntry } from '@/components/reception/RouteQRScannerEntry';
import { useIncomingRoutes } from '@/hooks/reception/useIncomingRoutes';
import { useOpenDiscrepancies } from '@/hooks/reception/useOpenDiscrepancies';
import { useOperatorId } from '@/hooks/useOperatorId';
import { arrivalTotals, buildArrivals, type ArrivalState } from './arrivals';
import { ReturnRouteList } from './ReturnRouteList';
import { ReturnReceptionSession } from './ReturnReceptionSession';

/**
 * spec-54 phase 4.6 — Recepción, estado inicial del módulo (mock 3c).
 *
 * The screen the receptionist sits on between counts. Its job is to make the
 * next action obvious: scan a route's QR, or pick the truck that has been
 * waiting longest. Opening a session hands off to the counting screen (1e).
 *
 * Returns keep their own tab: a return route is a different entity with its
 * own session, and the mock's arrivals table describes inbound routes only.
 */
export default function ReceptionPage() {
  const { operatorId } = useOperatorId();

  // "Entrantes" is in_progress, not in_transit: under spec-52 a route only
  // reaches in_transit once the receptionist has scanned its QR, so the trucks
  // actually on their way are the in_progress ones.
  const { data: incomingRoutes = [], isLoading: loadingIncoming } = useIncomingRoutes(
    operatorId,
    'in_progress',
  );
  const { data: yardRoutes = [], isLoading: loadingYard } = useIncomingRoutes(
    operatorId,
    'in_transit',
  );
  const { data: closedRoutes = [], isLoading: loadingClosed } = useIncomingRoutes(
    operatorId,
    'received',
  );
  const { data: discrepancies = [], isLoading: loadingDiscrepancies } =
    useOpenDiscrepancies(operatorId);

  const [showScanner, setShowScanner] = useState(false);
  const [selectedReturnRoute, setSelectedReturnRoute] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ArrivalState>('all');

  const arrivals = useMemo(
    () => buildArrivals({ yard: yardRoutes, transit: incomingRoutes, closed: closedRoutes }),
    [yardRoutes, incomingRoutes, closedRoutes],
  );
  const totals = arrivalTotals(arrivals);
  const isLoading = loadingIncoming || loadingYard || loadingClosed;

  return (
    <div className="flex min-h-0 flex-col gap-[18px] px-6 py-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold leading-[1.1] tracking-[-.02em] text-text">
            Recepción
          </h1>
          <p className="text-[12.5px] leading-none text-text-secondary">
            {totals.yardRoutes > 0
              ? `${totals.yardRoutes} ${totals.yardRoutes === 1 ? 'ruta esperando' : 'rutas esperando'} en patio`
              : 'Ninguna sesión de conteo abierta'}
            {' · '}
            <span className="font-mono font-semibold text-text">{totals.expectedRoutes}</span>{' '}
            {totals.expectedRoutes === 1 ? 'ruta esperada' : 'rutas esperadas'}
          </p>
        </div>
      </div>

      {/* The one action this screen exists for. Dashed accent border marks it
          as an invitation rather than a state. */}
      <div className="flex flex-none flex-wrap items-center gap-4 rounded-[13px] border-2 border-dashed border-accent bg-accent-muted px-[22px] py-5">
        <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-xl border border-accent bg-surface">
          <ScanLine className="h-[23px] w-[23px] text-accent" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="font-heading text-[15px] font-semibold leading-none text-text">
            Escanea el QR de la ruta para abrir el conteo
          </span>
          <span className="text-[11.5px] leading-[1.45] text-text-secondary">
            O selecciona una ruta de la lista. La sesión se abre a tu nombre y queda registrada en
            la bitácora de cada pedido.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowScanner(true)}
          className="ml-auto flex h-[38px] flex-none items-center gap-2 rounded-lg bg-accent-light px-4 text-[12.5px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
        >
          <QrCode className="h-3.5 w-3.5" />
          Escanear QR de ruta
        </button>
      </div>

      <div className="grid flex-none grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Rutas esperadas hoy"
          value={totals.expectedRoutes}
          detail={`· ${totals.expectedPackages} paq.`}
        />
        <StatTile
          label="En patio sin contar"
          value={totals.yardRoutes}
          tone={totals.yardRoutes > 0 ? 'warning' : 'neutral'}
          detail={totals.longestYardWait !== null ? `· espera ${totals.longestYardWait} min` : undefined}
        />
        <StatTile
          label="Cerradas · turno"
          value={totals.closedRoutes}
          detail={`· ${totals.closedPackages} paq.`}
        />
        <StatTile
          label="Diferencias abiertas"
          value={discrepancies.length}
          tone={discrepancies.length > 0 ? 'error' : 'neutral'}
        />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[1fr_330px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ArrivalsPanel
            rows={arrivals}
            filter={filter}
            onFilterChange={setFilter}
            isLoading={isLoading}
          />

          {/* Returns are a separate entity with their own session flow, so they
              stay a tab rather than joining the arrivals table. */}
          <Tabs defaultValue="returns">
            <TabsList>
              <TabsTrigger value="returns">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Retornos
              </TabsTrigger>
            </TabsList>
            <TabsContent value="returns" className="mt-3">
              {selectedReturnRoute && operatorId ? (
                <ReturnReceptionSession
                  operatorId={operatorId}
                  externalRouteId={selectedReturnRoute}
                  onBack={() => setSelectedReturnRoute(null)}
                />
              ) : (
                operatorId && (
                  <ReturnRouteList operatorId={operatorId} onSelectRoute={setSelectedReturnRoute} />
                )
              )}
            </TabsContent>
          </Tabs>
        </div>

        <PendingResolutionPanel
          discrepancies={discrepancies}
          isLoading={loadingDiscrepancies}
        />
      </div>

      <Dialog open={showScanner} onOpenChange={setShowScanner}>
        <DialogContent className="max-w-sm p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Escanear QR de ruta</DialogTitle>
          </DialogHeader>
          {showScanner && operatorId && (
            <RouteQRScannerEntry operatorId={operatorId} onResolved={() => setShowScanner(false)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
