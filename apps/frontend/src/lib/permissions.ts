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
 * Defaults applied on user creation. Mirrors the CASE in handle_new_user
 * (migration 20260811000001) — change both together or new users drift from
 * existing ones again.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, readonly string[]> = {
  pickup_crew: ['pickup'],
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
