"use client";

import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { computeOrderKpis } from './OrderTable';
import { TH, TD, TD_LINK, TD_MONO, TD_EMPTY, TR } from './tableStyles';
import { cn } from '@/lib/utils';
import type { StagePanelProps } from './PickupPanel';

type ReturnRow = {
  id: string;
  order_number: string;
  retailer_name: string;
  pickup_point_name: string;
  return_reason: string | null;
  return_reason_code: string | null;
  age_minutes: number | null;
  packages: unknown[];
  [key: string]: unknown;
};

type SlaBucket = 'OK' | 'En riesgo' | 'Tarde';

function getSlaBucket(ageMinutes: number | null): SlaBucket {
  if (ageMinutes === null) return 'OK';
  if (ageMinutes > 120) return 'Tarde';
  if (ageMinutes > 60) return 'En riesgo';
  return 'OK';
}

const SLA_BADGE: Record<SlaBucket, string> = {
  OK: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'En riesgo': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  Tarde: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function SlaBadge({ ageMinutes }: { ageMinutes: number | null }) {
  const bucket = getSlaBucket(ageMinutes);
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', SLA_BADGE[bucket])}>
      {bucket}
    </span>
  );
}

function ReturnOrderTable({ orders }: { orders: ReturnRow[] }) {
  if (orders.length === 0) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Orden</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Motivo de retorno</th>
              <th className={TH}>Código</th>
              <th className={TH}>Antigüedad</th>
              <th className={TH}>SLA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className={TD_EMPTY}>Sin retornos pendientes</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={TH}>Orden</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Motivo de retorno</th>
            <th className={TH}>Código</th>
            <th className={TH}>Antigüedad</th>
            <th className={TH}>SLA</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className={cn(TR)}>
              <td className={TD_LINK}>{o.order_number ?? '—'}</td>
              <td className={TD}>{o.retailer_name ?? '—'}</td>
              <td className={TD}>{o.return_reason ?? '—'}</td>
              <td className={TD_MONO}>{o.return_reason_code ?? '—'}</td>
              <td className={TD_MONO}>
                {o.age_minutes !== null && o.age_minutes !== undefined
                  ? `${o.age_minutes} min`
                  : '—'}
              </td>
              <td className={TD}>
                <SlaBadge ageMinutes={o.age_minutes ?? null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReturnsPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { rows, pageCount } = useStageBreakdown('returns', operatorId, 1);
  const returnRows = rows as ReturnRow[];

  return (
    <StagePanel
      title="Reingresos"
      subtitle="Órdenes devueltas pendientes de reingreso"
      deepLink={null}
      kpis={computeOrderKpis(rows)}
      page={1}
      pageCount={pageCount ?? 1}
      onPageChange={() => {}}
      lastSyncAt={lastSyncAt}
    >
      <ReturnOrderTable orders={returnRows} />
    </StagePanel>
  );
}
