'use client';

import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useOrderDossier } from '@/hooks/useOrderDossier';
import { OrderLifecycleTimeline } from '@/components/orders/OrderLifecycleTimeline';
import { ProofOfDelivery } from '@/components/orders/ProofOfDelivery';
import { WhyLateBlock } from '@/components/orders/WhyLateBlock';
import { Skeleton } from '@/components/ui/skeleton';
import { FichaHeader } from './components/FichaHeader';
import { FichaLeftColumn } from './components/FichaLeftColumn';
import { FichaCenterColumn } from './components/FichaCenterColumn';
import { breadcrumbHref, deliveryDispatch } from './_ficha-helpers';

/**
 * spec-65 Task 9 — `3b`, the order ficha page. Composes the same
 * `useOrderDossier` hook and the same five Task 7 blocks `1f`
 * (`OrderInspector`) does, but in three columns rather than a 720px sheet
 * — see the task brief for why this is a separate composition, not the
 * inspector widened.
 *
 * `WhyLateBlock` is included per the brief ("include it if it fits your
 * layout") with the same null inputs `1f` passes: `stage`/`reasonFlag`/
 * `stuckSinceISO` have no real source anywhere in the schema yet, so it
 * renders nothing today, by design (see that component's own doc comment).
 */
interface Props {
  orderId: string;
}

export function OrderFichaContent({ orderId }: Props) {
  const { operatorId } = useOperatorId();
  const searchParams = useSearchParams();
  const { data, isLoading, isError } = useOrderDossier(orderId, operatorId);

  if (isLoading || !data) {
    if (isError) {
      return <p className="p-6 text-sm text-status-error-text">Error al cargar la orden</p>;
    }
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const lastUpdated = data.auditLogs[0]?.timestamp ?? null;
  const pod = deliveryDispatch(data.dispatches);

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      <FichaHeader
        order={data}
        lastUpdated={lastUpdated}
        deliveryDispatch={pod}
        breadcrumbHref={breadcrumbHref(searchParams.toString())}
      />

      <div className="flex-none border-b border-border px-6 py-4">
        <OrderLifecycleTimeline auditLogs={data.auditLogs} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <FichaLeftColumn
          deliveryAddress={data.delivery_address}
          comuna={data.comuna}
          customerPhone={data.customer_phone}
          packages={data.packages}
          dispatches={data.dispatches}
        />

        <FichaCenterColumn auditLogs={data.auditLogs} dispatches={data.dispatches} />

        <div className="flex w-full flex-none flex-col gap-4 overflow-y-auto bg-surface p-4 lg:w-[330px] lg:border-l lg:border-border">
          <ProofOfDelivery dispatch={pod} />
          <WhyLateBlock stage={null} reasonFlag={null} stuckSinceISO={null} />
        </div>
      </div>
    </div>
  );
}
