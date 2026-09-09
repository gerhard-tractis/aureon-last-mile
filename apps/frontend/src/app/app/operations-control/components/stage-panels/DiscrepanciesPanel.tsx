'use client';

import { StagePanel } from '../StagePanel';
import { useDiscrepancies } from '@/hooks/ops-control/useDiscrepancies';
import { DiscrepancyTable, computeDiscrepancyKpis } from './DiscrepancyTable';
import type { StagePanelProps } from './PickupPanel';

/**
 * spec-86 fase 3 — the bulto that was retired at pickup, or received at the
 * hub, and never turned up. Fed by public.discrepancies (spec-85) via
 * get_discrepancies_ops_control (20260925000001), not by
 * get_ops_control_snapshot: a discrepancy is deliberately not attached to any
 * of the seven order/route stages, because the order it belongs to is either
 * unreachable from every stage (spec-86's "El agujero, medido" — a bulto that
 * closed short at reception vanishes from Ops Control entirely) or would be
 * shown as further along than it really is. This panel is where it surfaces
 * instead — and nowhere else.
 */
export function DiscrepanciesPanel({ operatorId }: StagePanelProps) {
  const { data } = useDiscrepancies(operatorId, 'open');
  const rows = data ?? [];

  return (
    <StagePanel
      title="Discrepancias"
      subtitle="Bultos que faltaron en recogida o recepción — un registro por paquete"
      deepLink={null}
      kpis={computeDiscrepancyKpis(rows)}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      // Ronda 2 (#715, mayor): lastSyncAt (from useOpsControlSnapshot,
      // unrelated to this panel's own query) is deliberately NOT passed
      // through, and liveLabel is null — this panel has no Realtime
      // subscription on public.discrepancies, so claiming "Tiempo real" (or
      // stamping an unrelated channel's timestamp) would be false.
      lastSyncAt={null}
      liveLabel={null}
    >
      <DiscrepancyTable rows={rows} />
    </StagePanel>
  );
}
