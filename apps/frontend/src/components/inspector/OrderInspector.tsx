'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { OrderLifecycleTimeline } from '@/components/orders/OrderLifecycleTimeline';
import { OrderPackageList } from '@/components/orders/OrderPackageList';
import { UnifiedEventLog } from '@/components/orders/UnifiedEventLog';
import { ProofOfDelivery } from '@/components/orders/ProofOfDelivery';
import { WhyLateBlock } from '@/components/orders/WhyLateBlock';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { PackageReprintLinks } from './PackageReprintLinks';
import { useOrderDossier, type OrderDossierData, type DossierDispatch } from '@/hooks/useOrderDossier';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { useOrderConversationSessions } from '@/hooks/conversations/useOrderConversationSessions';
import { ModuleKey } from '@/lib/modules/registry';
import type { ConversationSession } from '@/lib/conversations/types';

interface Props {
  orderId: string | null;
  onClose: () => void;
  /** spec-53 — PACKAGE_LABELS module gate, threaded down to the per-package reprint icon. */
  packageLabelsEnabled?: boolean;
}

/**
 * spec-65 Task 8 — `1f`, recomposed from Task 7's dossier hook and blocks.
 *
 * "Abrir en ruta" from the `1f` mock is NOT implemented: the dossier's
 * dispatch join only carries `routes.external_route_id` /
 * `routes.driver_name` (see `useOrderDossier.ts`), never `routes.id` — the
 * uuid `/app/dispatch/[routeId]` actually needs. Adding it means editing
 * `useOrderDossier`, a Task 7 file this task was told not to modify.
 * Fabricating a link from `external_route_id` (a provider-supplied string,
 * not the internal uuid) would silently 404 or open the wrong route, so the
 * button is omitted rather than shipped broken. Flagged for the controller.
 */
function formatChipTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDeliveryWindow(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${formatChipTime(start)}–${formatChipTime(end)}`;
}

function deliveryDispatch(dispatches: DossierDispatch[]): DossierDispatch | null {
  return dispatches.find((d) => !d.is_pickup) ?? null;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
      {children}
    </span>
  );
}

export function OrderInspector({ orderId, onClose, packageLabelsEnabled = false }: Props) {
  const { operatorId } = useOperatorId();
  const { data, isLoading, isError } = useOrderDossier(orderId, operatorId);
  const conversationsEnabled = useModuleEnabled(operatorId, ModuleKey.CONVERSATIONS);
  const { data: sessions } = useOrderConversationSessions(
    conversationsEnabled ? operatorId : null,
    conversationsEnabled ? orderId : null,
  );
  const [tab, setTab] = useState<'packages' | 'historial' | 'conversacion'>('packages');

  return (
    <Sheet open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[720px] h-full overflow-y-auto flex flex-col gap-0 p-0"
        data-testid="order-inspector"
      >
        {isLoading && (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-5 w-48 bg-surface-raised rounded" />
            <div className="h-4 w-64 bg-surface-raised rounded" />
          </div>
        )}

        {isError && !isLoading && (
          <p className="p-6 text-sm text-status-error-text">Error al cargar la orden</p>
        )}

        {!isLoading && !isError && data && (
          <OrderInspectorBody
            data={data}
            tab={tab}
            setTab={setTab}
            packageLabelsEnabled={packageLabelsEnabled}
            conversationsEnabled={conversationsEnabled}
            sessions={sessions ?? []}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface BodyProps {
  data: OrderDossierData;
  tab: 'packages' | 'historial' | 'conversacion';
  setTab: (tab: 'packages' | 'historial' | 'conversacion') => void;
  packageLabelsEnabled: boolean;
  conversationsEnabled: boolean;
  sessions: ConversationSession[];
}

function OrderInspectorBody({
  data,
  tab,
  setTab,
  packageLabelsEnabled,
  conversationsEnabled,
  sessions,
}: BodyProps) {
  const lastUpdated = data.auditLogs[0]?.timestamp ?? null;
  const pod = deliveryDispatch(data.dispatches);
  const route = pod?.external_route_id ?? null;
  const historialCount = data.auditLogs.length + data.dispatches.length;
  const latestSession = sessions[0] ?? null;

  return (
    <>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-lg font-mono font-semibold text-text">
                {data.order_number}
              </SheetTitle>
              <SheetDescription className="text-sm text-text-secondary mt-0.5">
                {data.customer_name}
              </SheetDescription>
              <p className="text-xs text-text-muted mt-0.5">
                {data.delivery_address}, {data.comuna} · {data.customer_phone}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={data.leading_status} size="md" />
              {lastUpdated && (
                <span className="font-mono text-[10.5px] text-text-muted">
                  actualizado {formatChipTime(lastUpdated)}
                </span>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 mt-3">
          <Chip>
            <span className="font-medium text-text">{data.packages.length}</span> paquetes
          </Chip>
          {data.retailer_name && <Chip>{data.retailer_name}</Chip>}
          <Chip>
            promesa <span className="font-medium text-text">{data.delivery_date}</span>
          </Chip>
          {formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end) && (
            <Chip>{formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end)}</Chip>
          )}
          {route && (
            <Chip>
              ruta <span className="font-medium text-text">{route}</span>
            </Chip>
          )}
        </div>
      </div>

      {/* Lifecycle */}
      <div className="px-6 py-4 border-b border-border flex flex-col gap-3">
        <span className="font-mono text-[9.5px] tracking-wide text-text-muted uppercase">
          Ciclo de vida
        </span>
        <OrderLifecycleTimeline auditLogs={data.auditLogs} />
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="flex-1 flex flex-col"
      >
        <TabsList className="mx-6 mt-4 w-auto justify-start">
          <TabsTrigger value="packages">Paquetes ({data.packages.length})</TabsTrigger>
          <TabsTrigger value="historial">Historial ({historialCount})</TabsTrigger>
          {conversationsEnabled && (
            <TabsTrigger value="conversacion">Conversación ({sessions.length})</TabsTrigger>
          )}
        </TabsList>

        <TabsContent
          forceMount
          value="packages"
          className="px-6 py-4 flex flex-col gap-3 data-[state=inactive]:hidden"
        >
          <OrderPackageList packages={data.packages} />
          <PackageReprintLinks
            packages={data.packages}
            manifestId={data.manifestId}
            labelsEnabled={packageLabelsEnabled}
          />
          <WhyLateBlock stage={null} reasonFlag={null} stuckSinceISO={null} />
        </TabsContent>

        <TabsContent
          forceMount
          value="historial"
          className="px-6 py-4 flex flex-col gap-3 data-[state=inactive]:hidden"
        >
          <UnifiedEventLog auditLogs={data.auditLogs} dispatches={data.dispatches} />
          <ProofOfDelivery dispatch={pod} />
        </TabsContent>

        {conversationsEnabled && (
          <TabsContent forceMount value="conversacion" className="px-6 py-4 data-[state=inactive]:hidden">
            {latestSession ? (
              <ConversationThread session={latestSession} canReply={false} />
            ) : (
              <p className="text-sm text-text-muted">
                Sin conversación registrada para este pedido.
              </p>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border flex justify-between items-center">
        <span className="text-xs text-text-faint font-mono">esc · cerrar</span>
        <button
          className="text-xs bg-surface-raised border border-border rounded px-3 py-1.5 text-text hover:bg-surface-elev transition-colors"
          onClick={() => navigator.clipboard?.writeText(data.order_number)}
        >
          Copiar ID
        </button>
      </div>
    </>
  );
}
