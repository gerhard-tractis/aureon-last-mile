/**
 * spec-51 — the Musan logins.
 *
 * Split out of musan.ts, which had grown past the 300-line rule once the carga
 * composition matrix landed. Nothing about the list changed in the move.
 *
 * Permissions are in the vocabulary the APPLICATION checks — pickup, reception,
 * distribution, dispatch, customer_service, admin — which migration
 * 20260811000001 made authoritative and handle_new_user now assigns per role
 * (pickup_leader added to that CASE by 20260820000002).
 *
 * These used to carry the database's legacy tokens (warehouse / loading /
 * operations). Nothing in the app reads those, so a user holding them could
 * never see Recepción or Distribución. 20260811000001 translated the rows
 * already in QA, but the values here were left behind — and createLoginUser
 * repairs an existing login by overwriting permissions, so the next seed run
 * would have written the legacy tokens straight back over the translation.
 * Keeping this list in the app's vocabulary is what stops that regression.
 *
 * Password is the shared QA one: QaTest123!
 */

import type { SeedClient } from '../lib/db';
import { createLoginUser } from '../lib/factories';
import { ScenarioGroup, qaId } from '../lib/ids';

export const MUSAN_LOGINS = [
  {
    seq: 20,
    email: 'admin@musan.com',
    role: 'admin',
    fullName: 'Musan Admin',
    permissions: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service', 'admin'],
  },
  {
    seq: 21,
    email: 'operaciones@musan.com',
    role: 'operations_manager',
    fullName: 'Musan Operaciones',
    permissions: ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'],
  },
  {
    seq: 22,
    email: 'bodega@musan.com',
    role: 'warehouse_staff',
    fullName: 'Musan Bodega',
    permissions: ['reception', 'distribution'],
  },
  {
    // spec-61 — Musan needs someone who can OPEN a pickup route, not just work
    // one. start_pickup_route gates route creation by ROLE (ROUTE_LEADER_ROLES
    // in lib/permissions.ts), never by a permission token, so the token set is
    // deliberately identical to pickup_crew's: the role is what grants it.
    seq: 23,
    email: 'lider@musan.com',
    role: 'pickup_leader',
    fullName: 'Musan Líder de Recogida',
    permissions: ['pickup'],
  },
  // The acompañantes. A leader with nobody to put on the route can tick no
  // boxes, so CrewSelect renders "No hay compañeros registrados" and the
  // ACOMPAÑANTES half of spec-61 was untestable on Musan — the operator that
  // carries the realistic data everyone actually tests against.
  //
  // The ROLE is what matters here, not the token: useCrewCandidates reads
  // `users` directly and filters `role IN ('pickup_crew','pickup_leader',
  // 'ops_leader')`, so a rider carrying the 'pickup' permission under any
  // other role is invisible to the picker. `pickup_crew` maps to exactly
  // ['pickup'] in PERMISSIONS (lib/permissions.ts) — the same token set as
  // the leader above, which is deliberate: leading is granted by the role.
  //
  // full_name is the display AND the sort key in that sheet, so the two are
  // named to land in a predictable order.
  {
    seq: 24,
    email: 'pickup1@musan.com',
    role: 'pickup_crew',
    fullName: 'Musan Recogida 1',
    permissions: ['pickup'],
  },
  {
    seq: 25,
    email: 'pickup2@musan.com',
    role: 'pickup_crew',
    fullName: 'Musan Recogida 2',
    permissions: ['pickup'],
  },
] as const;

/**
 * Create or repair every Musan login.
 *
 * Deliberately survives the Musan data purge (infra/supabase-qa/reset-musan.sql
 * keeps public.users and auth.users): a tester's saved credentials should not
 * change because the cargas were rebuilt.
 */
export async function seedMusanLogins(db: SeedClient, operatorId: string): Promise<void> {
  for (const login of MUSAN_LOGINS) {
    await createLoginUser(db, {
      id: qaId(ScenarioGroup.MUSAN, login.seq),
      operatorId,
      email: login.email,
      role: login.role,
      fullName: login.fullName,
      permissions: [...login.permissions],
    });
  }
}
