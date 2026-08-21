'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCrewCandidates } from '@/hooks/pickup/useCrewCandidates';

/**
 * spec-61 Task 5 — the leader picks who rides with them, on 3j.
 *
 * Its own component rather than more JSX inside PickupMobileStartRoute.tsx
 * (already 233 lines), which would have pushed that file past the 300-line
 * limit.
 *
 * Stateless: `value` / `onChange` only. The selection has to survive as the
 * same array the "Iniciar ruta" button hands to `start_pickup_route`, and a
 * second copy of it inside this component is a desync waiting to happen.
 *
 * LABEL (DECIDED 2026-08-21): `ACOMPAÑANTES · N`, not `EQUIPO · N`. N counts
 * the ticked rows below, which are leader-EXCLUSIVE by construction —
 * `useCrewCandidates` filters the signed-in user out, so the leader is never
 * a row here. 3h's `PickupRouteCrewStrip` keeps `EQUIPO · N` with N
 * leader-INCLUSIVE, because a roster that omits the person driving is not
 * "who is on the trip". Both counts are right for their own screen; sharing
 * one word made the number appear to change under the driver as they moved
 * between the two.
 */

const NO_NAME = 'Sin nombre';

export interface CrewSelectProps {
  operatorId: string | null;
  /** The signed-in user — never offered as their own crew. */
  excludeUserId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function CrewSelect({ operatorId, excludeUserId, value, onChange }: CrewSelectProps) {
  const { data: candidates, isLoading } = useCrewCandidates(operatorId, excludeUserId);
  const rows = candidates ?? [];

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <section aria-labelledby="crew-select-eyebrow" className="mt-3 flex flex-col gap-2">
      {/* `text-text-secondary`, not the `text-text-muted` the neighbouring
          eyebrow uses: this renders INSIDE PickupMobileStartRoute's accent
          card, where text-muted on bg-accent-muted is 2.52:1 light / 4.49:1
          dark at 10.5px. The sibling "NO TIENES RUTA ACTIVA" eyebrow fails
          identically and is left alone -- it is pre-existing, and fixing it
          here would smuggle an unrelated change into this task. */}
      <p
        id="crew-select-eyebrow"
        className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-secondary"
      >
        ACOMPAÑANTES · {value.length}
      </p>

      {isLoading ? (
        <p className="text-[12.5px] text-text-secondary">Cargando compañeros…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] text-text-secondary">No hay compañeros registrados</p>
      ) : (
        // max-h-[45vh] + scroll, not an unbounded list. This renders inside
        // PickupMobileStartRoute's accent card and ABOVE "Iniciar ruta de
        // recogida", and useCrewCandidates fetches every non-deleted
        // pickup_crew/pickup_leader in the operator with no limit -- so a
        // twenty-person operator pushed ~880px of rows between the vehicle
        // picker and the primary CTA, off the bottom of a 390px screen.
        // Capping the LIST rather than the fetch keeps everyone reachable by
        // scrolling; the eyebrow above still counts all of them, so the
        // number is never what gets truncated.
        <div className="max-h-[45vh] overflow-y-auto rounded-[10px] border border-border bg-surface">
          {rows.map((person) => {
            const checked = value.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={person.full_name ?? NO_NAME}
                onClick={() => toggle(person.id)}
                className="flex min-h-[44px] w-full items-center gap-3 border-b border-border-subtle px-3.5 py-2 text-left last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border',
                    // `border-border-strong` unchecked, not `border-border`:
                    // at 1.23:1 light / 1.11:1 dark against bg-surface the
                    // box was invisible, and it is both a form-control
                    // boundary (WCAG 1.4.11 wants 3:1) and the only cue an
                    // unchecked row is tappable at all.
                    checked
                      ? 'border-accent-light bg-accent-light'
                      : 'border-border-strong bg-surface',
                  )}
                >
                  {checked && (
                    <Check className="h-3 w-3 text-accent-light-foreground" strokeWidth={3.4} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                  {person.full_name ?? NO_NAME}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
