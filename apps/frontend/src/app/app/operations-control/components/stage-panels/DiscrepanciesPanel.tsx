'use client';

import { StagePanel } from '../StagePanel';
import { useDiscrepancies, isDiscrepanciesUnknown } from '@/hooks/ops-control/useDiscrepancies';
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
  const { data, isLoading, isError, fetchStatus } = useDiscrepancies(operatorId, 'open');
  // Ronda 3 (#715, M1): the tile this panel opens from already learned (ronda
  // 2) to show "—"/neutral instead of a confident "0" while loading, offline
  // (fetchStatus='paused'), or errored. This panel kept `data ?? []`, so
  // clicking the honest "—" tile opened a panel that confidently said "Sin
  // discrepancias abiertas" across three KPIs — worse than the original bug,
  // because the click happens PRECISELY when the user does not know the
  // answer. isDiscrepanciesUnknown is the same check the tile uses, shared so
  // the two cannot drift again.
  const unknown = isDiscrepanciesUnknown({ data, isLoading, isError, fetchStatus });
  const rows = data ?? [];

  return (
    <StagePanel
      title="Discrepancias"
      subtitle="Bultos que faltaron en recogida o recepción — un registro por paquete"
      deepLink={null}
      kpis={unknown ? [] : computeDiscrepancyKpis(rows)}
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
      {unknown ? (
        <div data-testid="discrepancies-panel-unknown" className="px-4 py-8 text-center text-sm text-text-muted">
          No se pudo confirmar el estado de las discrepancias todavía.
        </div>
      ) : (
        <DiscrepancyTable rows={rows} />
      )}
    </StagePanel>
  );
}
