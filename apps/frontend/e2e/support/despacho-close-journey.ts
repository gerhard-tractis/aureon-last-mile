/**
 * spec-77 Fase 5 / spec-79 Fase 5 — UI/RPC lifecycle for
 * `despacho-close-dispatch.spec.ts`. Mirrors `despacho-journey.ts`'s own
 * `openRouteToLoad()` (real `POST /api/dispatch/routes`, not a row insert —
 * see that file's header for why) but parameterised by order numbers so the
 * same helper can open Route H, R, and L from `despacho-close-fixture.ts`.
 */
import type { Page } from '@playwright/test';
import { db, signIn } from './spec52-fixture';
import { CREW, PREFIX, toRouteCode } from './despacho-close-fixture';

/** See `despacho-journey.ts`'s own copy of this helper for why it is kept
 *  local rather than imported from `@/lib/utils/dateFormat` (Lecciones
 *  aplicadas #3 — this file only needs the one `Intl.DateTimeFormat` call). */
function santiagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}

export interface DespachoCloseRoute { id: string; code: string; }

let signedIn = false;

/**
 * Opens a route for exactly the given order numbers (from
 * despacho-close-fixture.ts's own STOP/ORDER constants), signing the crew
 * in once and reusing that session for every subsequent call in the same
 * test run — the fixture's three routes are opened sequentially on one
 * `page`, same one-context convention despacho-crew-mobile.spec.ts's own
 * header explains.
 */
export async function openRouteForOrders(page: Page, orderNumbers: string[]): Promise<DespachoCloseRoute> {
  if (!signedIn) {
    const { rows: crewRows } = await db().query(`SELECT id FROM auth.users WHERE email = $1`, [CREW.email]);
    if (crewRows.length === 0) {
      throw new Error(`openRouteForOrders() requires seed() to have run first — no auth.users row for ${CREW.email}`);
    }
    await signIn(page, CREW);
    signedIn = true;
  }

  const { rows: orderRows } = await db().query(
    `SELECT id FROM orders WHERE order_number = ANY($1::text[])`,
    [orderNumbers],
  );
  if (orderRows.length !== orderNumbers.length) {
    throw new Error(
      `openRouteForOrders() expected ${orderNumbers.length} seeded orders (${orderNumbers.join(', ')}), ` +
      `found ${orderRows.length} — did seed() run for the '${PREFIX}' namespace?`,
    );
  }

  const response = await page.request.post('/api/dispatch/routes', {
    data: {
      order_ids: orderRows.map((r) => r.id as string),
      route_date: santiagoToday(),
    },
  });
  if (!response.ok()) {
    throw new Error(
      `openRouteForOrders(): POST /api/dispatch/routes returned ${response.status()} — ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { id: string };
  return { id: body.id, code: toRouteCode(body.id) };
}

/** Test-module state does not reset between files in the same worker, but
 *  each spec file gets a fresh module instance under Playwright's default
 *  isolation — exported so a `beforeAll` can force a resignin if a future
 *  suite reuses this file across multiple `test.describe` blocks with
 *  separate browser contexts. */
export function resetSignedIn(): void {
  signedIn = false;
}
