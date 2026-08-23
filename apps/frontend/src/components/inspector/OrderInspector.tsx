'use client';

import { useState } from 'react';
import Link from 'next/link';
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

/**
 * spec-65 Task 8 — `1f`, recomposed from Task 7's dossier hook and blocks.
 *
 * "Abrir en ruta" links to `/app/dispatch/${route_id}` — the same path
 * `/app/dispatch`'s own route tiles and "new route" flow navigate to
 * (`router.push(`/app/dispatch/${route.id}`)`) — using `route_id`
 * (`routes.id`, the dossier's dispatch-join uuid, added in this task per
 * controller ruling), never `external_route_id` (a DispatchTrack-supplied
 * string with no relationship to the internal id). The button is absent,
 * not disabled, when there's no non-pickup dispatch or that dispatch has no
 * joined route — same "absent, not a dead link" rule as everything else
 * `1f` omits rather than fabricates.
 */
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
  const routeId = pod?.route_id ?? null;
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
          <TabsContent
            forceMount
            value="conversacion"
            className="px-6 py-4 flex flex-col gap-3 data-[state=inactive]:hidden"
          >
            {/*
             * Deliberate scope, not an unfinished feature (controller
             * ruling, spec-65 Task 8 round 2): `1f` answers "what happened
             * to this order" without leaving the current screen. Replying
             * to a customer is `/app/conversations`'s job, with its own
             * permission gating (canReply there checks role/permissions;
             * this tab never offers to reply, so it stays read-only for
             * every viewer). Showing more than the most recent session
             * inline would turn this tab into a second conversations
             * list — the multi-session notice below exists so that a
             * second session is *visible*, not silently dropped, without
             * `1f` rebuilding that list itself.
             */}
            {sessions.length > 1 && (
              <p className="text-xs text-text-muted">
                Hay {sessions.length} conversaciones para este pedido — mostrando la más
                reciente.{' '}
                <Link href="/app/conversations" className="text-accent hover:underline">
                  Ver todas en Conversaciones
                </Link>
              </p>
            )}
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
        <div className="flex gap-2">
          <button
            className="text-xs bg-surface-raised border border-border rounded px-3 py-1.5 text-text hover:bg-surface-raised transition-colors"
            onClick={() => navigator.clipboard?.writeText(data.order_number)}
          >
            Copiar ID
          </button>
          {routeId && (
            <Link
              href={`/app/dispatch/${routeId}`}
              className="text-xs bg-surface-raised border border-border rounded px-3 py-1.5 text-text hover:bg-surface-raised transition-colors"
            >
              Abrir en ruta
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
