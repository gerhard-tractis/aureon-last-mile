'use client';

import { Users } from 'lucide-react';

/**
 * spec-61 — what a picker who is NOT a route leader sees when no route is
 * open for them.
 *
 * Deliberately not 3j. `start_pickup_route` refuses a caller who cannot lead
 * (migration 20260820000003), so a vehicle selector and an "Iniciar ruta"
 * button here could only ever produce an error toast — the definition of a
 * control that lies. The copy names the leader instead, because the fix is
 * ten seconds of asking, which is the trade the spec makes: a loud failure
 * beats a silent second route for the same van.
 *
 * ONE blank state, not two (spec-61, "DECIDED 2026-08-21 — no signal"). A
 * crew member whose seat was released by a route reopen lands here too, with
 * no mention that anything changed: the recovery action is identical either
 * way — find your leader and ask to be re-added — so a bespoke "your seat was
 * released" state would buy them nothing and cost a second empty screen to
 * keep honest. `pickup_route_crew` still stamps `removed_at`, so the
 * information needed to add that signal later is not being discarded.
 */
export function PickupMobileNoRoute() {
  return (
    <section
      data-testid="pickup-mobile-no-route"
      className="rounded-[10px] border border-border bg-surface p-5 text-center"
    >
      <Users className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" />
      {/* The wording from the DECIDED block, not Step 3's draft: it names the
          action ("pídele … que te agregue") rather than only the absence, and
          it is the text the decision was taken against. Deliberately the same
          sentence route/active/page.tsx shows for the same situation — one
          answer to "where is my route", wherever the picker happens to be. */}
      <p className="mt-3 font-heading text-[15px] font-semibold text-text">
        No tienes una ruta activa.
      </p>
      <p className="mt-1.5 text-[13px] leading-[1.45] text-text-secondary">
        Pídele a tu líder que te agregue a su ruta.
      </p>
    </section>
  );
}
