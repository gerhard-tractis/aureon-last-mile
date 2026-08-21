/**
 * What a carga's manifest row must look like for the load to land on the
 * Pickup tab its stage names — and the mirror of the three RPCs that decide
 * that, so the mapping can be tested without a database.
 *
 * Both halves used to be inline ternaries in scenarios/musan.ts. They are here
 * because the seed's claim ("one carga per tab") is only worth making if it can
 * be checked, and because the tab rules changed under the seed once already:
 * spec-61 Task 7 added `pickup_route_id IS NOT NULL` to the pending exclusion,
 * which silently emptied every tab for a tenant whose manifests had been
 * attached to a route by hand.
 */

/** Where a carga sits in the pickup lifecycle. */
export const CARGA_STAGES = ['pending', 'scanning', 'in_transit', 'completed'] as const;

export type CargaStage = (typeof CARGA_STAGES)[number];

export type ManifestStatus = 'pending' | 'in_progress' | 'completed';
export type ReceptionStatus = 'awaiting_reception' | 'received' | null;

export interface ManifestState {
  status: ManifestStatus;
  receptionStatus: ReceptionStatus;
  /**
   * Whether the seed inserts a manifest for a load that has none.
   *
   * False for `pending` on purpose: as get_pending_manifests puts it, "pending
   * loads may not have a manifest row until the operator opens the scan flow".
   * A load with no row is still pending, so inventing one would seed a state
   * the product never produces. An existing row is still CONVERGED to this
   * state — that is what un-does drift without fabricating anything.
   */
  createWhenMissing: boolean;
}

const STATE_BY_STAGE: Record<CargaStage, ManifestState> = {
  pending: { status: 'pending', receptionStatus: null, createWhenMissing: false },
  scanning: { status: 'in_progress', receptionStatus: null, createWhenMissing: true },
  in_transit: {
    status: 'in_progress',
    receptionStatus: 'awaiting_reception',
    createWhenMissing: true,
  },
  completed: { status: 'completed', receptionStatus: 'received', createWhenMissing: true },
};

export function manifestStateForStage(stage: CargaStage): ManifestState {
  return STATE_BY_STAGE[stage];
}

/** The manifest columns the three Pickup RPCs actually branch on. */
export interface ManifestRow {
  status: ManifestStatus;
  receptionStatus: ReceptionStatus;
  /** pickup_route_id IS NOT NULL. */
  routed: boolean;
}

/** 'none' means the load shows on no Pickup tab at all. */
export type PickupTab = 'pending' | 'in_transit' | 'completed' | 'none';

/**
 * Mirrors the predicates in get_pending_manifests / get_in_transit_manifests /
 * get_completed_manifests. `null` is a load with no live manifest row.
 */
export function pickupTabForManifest(row: ManifestRow | null): PickupTab {
  if (row === null) return 'pending';
  if (row.status === 'completed') return 'completed';
  if (row.receptionStatus !== null) return 'in_transit';
  // Checked last: a routed load is excluded from pending, but a routed manifest
  // that is completed or awaiting reception still shows on those tabs.
  if (row.routed) return 'none';
  return 'pending';
}
