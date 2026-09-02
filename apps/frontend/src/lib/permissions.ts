/**
 * The permission vocabulary, in one place.
 *
 * Two vocabularies coexisted from March 2026 until 20260811000001: the
 * application checked pickup / reception / distribution / dispatch /
 * customer_service, while the database's role backfill granted warehouse /
 * loading / operations. Neither side referenced the other's, so a user carrying
 * the database's set could never see Recepción or Distribución in the sidebar,
 * whatever their role.
 *
 * The list also lived in two API route files, which is how it drifted in the
 * first place. It lives here now, and the database's role defaults in
 * handle_new_user must stay in step with ROLE_DEFAULT_PERMISSIONS below.
 */

/** Grantable through /admin. 'admin' is deliberately not here. */
export const VALID_PERMISSIONS = [
  'pickup',
  'reception',
  'distribution',
  'dispatch',
  'customer_service',
] as const;

export type Permission = (typeof VALID_PERMISSIONS)[number];

/**
 * Every permission the app understands, including 'admin', which is implied by
 * the role rather than granted in the users UI.
 */
export const ALL_PERMISSIONS = [...VALID_PERMISSIONS, 'admin'] as const;

/**
 * A reference copy of the database's role -> permissions mapping, not
 * applied defaults: the actual defaults come from the handle_new_user
 * trigger (migration 20260811000001), and api/users/route.ts:293-298
 * overrides this map's values on user creation anyway. This constant's only
 * job is to stay identical to that CASE so the two never silently drift;
 * its test enforces self-consistency, not runtime behavior. There is no
 * other runtime consumer.
 *
 * spec-61 — pickup_leader is added here ahead of the database: the
 * handle_new_user CASE (spec-61 Task 1.2, not yet written) is what will add
 * it on the database side. Until that migration lands, this entry is a
 * forward reference, not a mirror.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, readonly string[]> = {
  pickup_crew: ['pickup'],
  // spec-61 — a leader does the same work plus opening the route. Route
  // creation is gated by ROLE in start_pickup_route, not by a permission
  // token, so the token set is deliberately identical to pickup_crew's.
  pickup_leader: ['pickup'],
  // spec-66 — mirrors the handle_new_user CASE in migration 20260824000002.
  // All four stations; no customer_service and no admin, because this is a
  // floor role, not a management one.
  ops_leader: ['pickup', 'reception', 'distribution', 'dispatch'],
  warehouse_staff: ['reception', 'distribution'],
  loading_crew: ['distribution', 'dispatch'],
  operations_manager: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'],
  admin: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service', 'admin'],
  super_admin: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service', 'admin'],
};

/** Tokens the database used to grant that nothing ever checked. */
export const LEGACY_PERMISSIONS = ['warehouse', 'loading', 'operations'] as const;

export function isValidPermission(value: string): value is Permission {
  return (VALID_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Roles that may open a pickup route (spec-61).
 *
 * The UI twin of the role gate in `start_pickup_route`. The database is the
 * enforcement — this only decides whether to render a control — so it must
 * never be more permissive than the RPC. operations_manager / admin /
 * super_admin are here because they can start routes today and spec-61 was
 * not about taking that away.
 *
 * KEEP IDENTICAL to the NOT IN list in migration 20260824000003. If this list
 * gains a role the RPC refuses, the UI offers a button that always errors.
 *
 * spec-66 — ops_leader leads routes as well as working the other three
 * stations, so it is here too. It is deliberately NOT added to
 * cancel_pickup_route's manager override: that function authorises the
 * route's own driver_id, which already covers an ops_leader cancelling their
 * own route, and leading routes is not authority over someone else's.
 *
 * NOTE: the caller's role comes from the JWT claim
 * (lib/context/GlobalContext.tsx:58), which is minted at login. A user just
 * promoted to pickup_leader or ops_leader keeps the old answer until their
 * token refreshes — they must sign out and back in.
 *
 * Call sites (spec-61 Task 5): PickupMobileView picks 3j or the crew screen
 * with it, and app/app/pickup/page.tsx gates the desktop `1l` draft panel's
 * own start button the same way.
 */
export const ROUTE_LEADER_ROLES = [
  'ops_leader',
  'pickup_leader',
  'operations_manager',
  'admin',
  'super_admin',
] as const;

export function canLeadPickupRoute(role: string | null | undefined): boolean {
  return !!role && (ROUTE_LEADER_ROLES as readonly string[]).includes(role);
}

/**
 * Who may take a stop off a route's plan.
 *
 * spec-70 decision 2 makes a plan a commitment: a planned stop goes on the
 * truck unless a manager removes it, with a reason and an audit entry. The
 * person holding the scanner is deliberately not on this list — the whole point
 * is that the load cannot quietly diverge from the plan.
 *
 * ROUTE_LEADER_ROLES minus `pickup_leader`, which leads inbound pickup routes
 * and has no authority over a delivery plan.
 */
export const PLAN_MANAGER_ROLES = [
  'ops_leader',
  'operations_manager',
  'admin',
  'super_admin',
] as const;

export function canRemoveFromPlan(role: string | null | undefined): boolean {
  return !!role && (PLAN_MANAGER_ROLES as readonly string[]).includes(role);
}

/**
 * Who may configure `dock_zone_adjacency` pairs and (later) `routes.max_drops`
 * (spec-73 phase 3, Decision 5.1 / Open Questions).
 *
 * The spec's own text guesses `ops_leader`/`admin`/`operations_manager` —
 * spec-68's `MANAGER_ROLES` (useManualDockAssignment.ts), which gates the
 * OTHER manager-only distribution action (manual dock assignment) but is a
 * UI-only check with no server enforcement. This reuses `PLAN_MANAGER_ROLES`
 * verbatim instead: spec-70's `canRemoveFromPlan` gate, the precedent that IS
 * enforced server-side (the DELETE .../packages/[pkgId] route, and the
 * add/remove_dock_zone_adjacency_pair RPCs mirror the same pattern one level
 * lower, in SQL). It is a strict superset of spec-68's three roles — the same
 * three plus `super_admin`, which every other manager-only gate in this repo
 * (`PLAN_MANAGER_ROLES`, `ROUTE_LEADER_ROLES`) already includes and which has
 * no principled reason to be excluded here.
 */
export const DOCK_ZONE_ADJACENCY_MANAGER_ROLES = PLAN_MANAGER_ROLES;

export function canManageDockZoneAdjacency(role: string | null | undefined): boolean {
  return canRemoveFromPlan(role);
}
