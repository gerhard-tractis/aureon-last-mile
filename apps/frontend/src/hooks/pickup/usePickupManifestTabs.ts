import { useMemo } from 'react';
import {
  usePendingManifests,
  useInTransitManifests,
  useCompletedManifests,
  useSignatureRescueManifests,
} from '@/hooks/pickup/useManifests';
import { useRoutedManifests, type RoutedManifest } from '@/hooks/pickup/useRoutedManifests';
import { pendingToRows, totalsToRows, manifestsAvailability, rescueRowsFromCompleted } from '@/lib/pickup/pickupPageHelpers';
import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

/**
 * spec-94 fase 2 — extracted from page.tsx (which sits at exactly the
 * 300-line CLAUDE.md limit) so the fourth tab's query doesn't push it over.
 * Not four queries, FIVE: `useSignatureRescueManifests` is a real fifth
 * data source (the mobile rescue banner), and it produces rows too, via
 * `rescueRowsFromCompleted` — dropping it from this extraction would leave
 * it half-migrated.
 */
export function usePickupManifestTabs(operatorId: string | null, isBelowLg: boolean) {
  const { data: pending } = usePendingManifests(operatorId);
  const { data: routed } = useRoutedManifests(operatorId);
  // item 8 (spec-54 3h) — mobile has no "en tránsito" tab, so it's skipped
  // on a phone. useCompletedManifests stays unconditional for closures.
  const { data: inTransit } = useInTransitManifests(operatorId, !isBelowLg);
  const { data: completed } = useCompletedManifests(operatorId);

  // spec-80 fase 2b (ronda 3) — scoped, NOT useCompletedManifests.
  const {
    data: rescueData,
    isPending: rescuePending,
    isError: rescueError,
    fetchStatus: rescueFetchStatus,
    refetch: refetchRescue,
  } = useSignatureRescueManifests(operatorId);

  const pendingRows: ManifestRow[] = useMemo(() => pendingToRows(pending ?? []), [pending]);
  const routedRows: RoutedManifest[] = routed ?? [];
  const inTransitRows: ManifestRow[] = useMemo(() => totalsToRows(inTransit ?? []), [inTransit]);
  const completedRows: ManifestRow[] = useMemo(() => totalsToRows(completed ?? []), [completed]);
  const rescueManifests: RouteManifestRow[] = useMemo(
    () => rescueRowsFromCompleted(rescueData ?? []),
    [rescueData],
  );
  const rescueAvailability = manifestsAvailability({
    isPending: rescuePending,
    isError: rescueError,
    fetchStatus: rescueFetchStatus,
  });

  return {
    pending: pending ?? [],
    routed: routedRows,
    inTransit: inTransit ?? [],
    completed: completed ?? [],
    pendingRows,
    routedRows,
    inTransitRows,
    completedRows,
    rescueManifests,
    rescueAvailability,
    refetchRescue,
  };
}
