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
 * The UI twin of the role gate that will land in `start_pickup_route`
 * (spec-61 Task 2, not yet written). The database is the enforcement — this
 * only decides whether to render a control — so it must never be more
 * permissive than the RPC. operations_manager / admin / super_admin are
 * here because they can start routes today and this spec is not about
 * taking that away.
 *
 * NOTE: the caller's role comes from the JWT claim
 * (lib/context/GlobalContext.tsx:53), which is minted at login. A user just
 * promoted to pickup_leader keeps the old answer until their token refreshes.
 *
 * Call sites (spec-61 Task 5): PickupMobileView picks 3j or the crew screen
 * with it, and app/app/pickup/page.tsx gates the desktop `1l` draft panel's
 * own start button the same way.
 */
export const ROUTE_LEADER_ROLES = [
  'pickup_leader',
  'operations_manager',
  'admin',
  'super_admin',
] as const;

export function canLeadPickupRoute(role: string | null | undefined): boolean {
  return !!role && (ROUTE_LEADER_ROLES as readonly string[]).includes(role);
}
