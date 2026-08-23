import { format } from 'date-fns';
import { OrderPackageList } from '@/components/orders/OrderPackageList';
import { lastWebhookTimestamp } from '../_ficha-helpers';
import type { DossierPackage, DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 9 — `3b`'s left column: delivery address, `OrderPackageList`
 * (Task 7, composed unmodified), and ORIGEN DE LOS DATOS.
 *
 * ORIGEN DE LOS DATOS shows all three of the mock's lines. "Canal" renders
 * `orders.imported_via` verbatim (`API`/`EMAIL`/`MANUAL`/`CSV`, the enum's
 * own values) rather than a translated label — no existing screen in the
 * repo maps this enum to display copy, and "show what arrives" is the same
 * rule `UnifiedEventLog` follows for DispatchTrack's own `substatus`
 * strings (controller-authorized extension, round 2 — `imported_via` is
 * now selected by `useOrderDossier`). "Courier" is shown as a static
 * "DispatchTrack" label whenever at least one dispatch row exists — the
 * same assumption `UnifiedEventLog` already makes for every
 * dispatch-sourced event, not a new one introduced here. The mock's
 * "Eventos recibidos 9 de 14" line is omitted entirely per the task brief
 * (no expected-event-total concept exists), and "Sin conserjería
 * registrada · 2 fallos previos" is omitted per spec-65's own deviation
 * table (no address intelligence exists).
 */
interface Props {
  deliveryAddress: string;
  comuna: string;
  customerPhone: string;
  packages: DossierPackage[];
  dispatches: DossierDispatch[];
  importedVia: string;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </span>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <span className="ml-auto text-[11px] font-medium text-text">{value}</span>
    </div>
  );
}

export function FichaLeftColumn({
  deliveryAddress,
  comuna,
  customerPhone,
  packages,
  dispatches,
  importedVia,
}: Props) {
  const hasCourierData = dispatches.length > 0;
  const lastWebhook = lastWebhookTimestamp(dispatches);

  return (
    <div className="flex w-full flex-none flex-col gap-4 overflow-y-auto border-b border-border bg-surface p-4 lg:w-[290px] lg:border-b-0 lg:border-r">
      <div className="flex flex-col gap-2">
        <SectionLabel>Dirección de entrega</SectionLabel>
        <p className="text-[11.5px] leading-relaxed text-text-body">
          {deliveryAddress}
          <br />
          {comuna}
        </p>
        <span className="font-mono text-[11px] font-medium text-text-secondary">{customerPhone}</span>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Paquetes · {packages.length}</SectionLabel>
        <OrderPackageList packages={packages} />
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Origen de los datos</SectionLabel>
        {importedVia && <DataRow label="Canal" value={importedVia} />}
        {hasCourierData && <DataRow label="Courier" value="DispatchTrack" />}
        {lastWebhook && <DataRow label="Último webhook" value={format(new Date(lastWebhook), 'HH:mm:ss')} />}
      </div>
    </div>
  );
}
