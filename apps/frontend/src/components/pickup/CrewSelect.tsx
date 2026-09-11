'use client';

import { useEffect } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCrewCandidates, type CrewRole } from '@/hooks/pickup/useCrewCandidates';

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
 * LABEL (DECIDED 2026-08-21, format updated spec-95 fase 4): `ACOMPAÑANTES`
 * with an `N de M` counter next to it, not `EQUIPO · N`. N counts the ticked
 * rows below and M the full candidate roster, both leader-EXCLUSIVE by
 * construction — `useCrewCandidates` filters the signed-in user out, so the
 * leader is never a row here. 3h's `PickupRouteCrewStrip` keeps `EQUIPO · N`
 * with N leader-INCLUSIVE, because a roster that omits the person driving is
 * not "who is on the trip". Both counts are right for their own screen;
 * sharing one word made the number appear to change under the driver as they
 * moved between the two.
 */

const NO_NAME = 'Sin nombre';

/**
 * spec-95 fase 4 — el mock (`5b`) rotula cada fila con su rol, a la derecha.
 * `useCrewCandidates` ya trae `role` tipado (`CrewRole`,
 * `useCrewCandidates.ts`); esto sólo lo traduce a la etiqueta del mock.
 * `pickup_leader` y `ops_leader` comparten "conductor" — el corte real es
 * `ROUTE_LEADER_ROLES` (`permissions.ts:98-103`, quién puede abrir una ruta),
 * NO `ROLE_DEFAULT_PERMISSIONS` como decía una versión anterior de este
 * comentario: ahí `pickup_leader` es en realidad IDÉNTICO a `pickup_crew`
 * (['pickup'] los dos) y `ops_leader` es el que difiere (los cuatro
 * módulos) — el corte contrario al de esta etiqueta. El mock sólo distingue
 * dos palabras, no tres roles; `Record<CrewRole, string>` es exhaustivo a
 * propósito — un rol nuevo en `CREW_ROLES` sin entrada aquí deja de
 * compilar en vez de caer en un default silencioso.
 */
const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  pickup_crew: 'auxiliar',
  pickup_leader: 'conductor',
  ops_leader: 'conductor',
};

function crewRoleLabel(role: CrewRole): string {
  return CREW_ROLE_LABELS[role];
}

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

  // Review round 1 (spec-95 fase 4) — `value` is state the PARENT owns and
  // `candidates` comes from a query with a 5-minute `staleTime`; a ticked
  // person soft-deleted or moved off the van roles elsewhere while this
  // screen is open falls out of `candidates` on the next refetch but stays
  // in `value`. Left alone that both mislabels the counter ("2 de 1") AND
  // still hands that stale id to `start_pickup_route`, so this prunes the
  // SOURCE array via `onChange`, not just the displayed count. Guarded on
  // `candidates` (not `rows`) being defined: pruning against the `[]`
  // fallback while the query is still loading would wipe every ticked id
  // before the real roster ever arrives.
  useEffect(() => {
    if (!candidates) return;
    const validIds = new Set(candidates.map((c) => c.id));
    const pruned = value.filter((id) => validIds.has(id));
    if (pruned.length !== value.length) onChange(pruned);
    // `value`/`onChange` deliberately excluded: this must re-run when the
    // ROSTER changes, not on every tap (`value` changing alone). The closure
    // still reads the CURRENT `value`/`onChange` from this render, so
    // nothing goes stale — see the block comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  return (
    <section aria-labelledby="crew-select-eyebrow" className="mt-3 flex flex-col gap-2">
      {/* `text-text-secondary`, not the `text-text-muted` the neighbouring
          eyebrow uses: this renders INSIDE PickupMobileStartRoute's accent
          card, where text-muted on bg-accent-muted is 2.52:1 light / 4.49:1
          dark at 10.5px. The sibling "NO TIENES RUTA ACTIVA" eyebrow fails
          identically and is left alone -- it is pre-existing, and fixing it
          here would smuggle an unrelated change into this task. */}
      <div className="flex items-center gap-2">
        <p
          id="crew-select-eyebrow"
          className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-secondary"
        >
          ACOMPAÑANTES
        </p>
        {/* "N de M": N ticados sobre M candidatos TOTALES (no filtrados por
            búsqueda ni nada más) — el mock (`5b`) lo dibuja así, "2 de 3".
            Un guión mientras carga, no "0 de 0": `rows` es `[]` antes de que
            la query resuelva, y un número junto a "Cargando compañeros…"
            promete un equipo vacío que todavía no se sabe que lo es. */}
        <p className="ml-auto font-mono text-[12.5px] font-semibold text-text-secondary">
          {isLoading ? '—' : `${value.length} de ${rows.length}`}
        </p>
      </div>

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
                // Review round 1 (spec-95 fase 4): `aria-label` REPLACES the
                // accessible name, it does not merge with the visible role
                // `<span>` below — so the role has to be composed IN here,
                // or assistive tech never hears it at all.
                aria-label={`${person.full_name ?? NO_NAME}, ${crewRoleLabel(person.role)}`}
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
                <span className="flex-none text-[12px] text-text-muted">
                  {crewRoleLabel(person.role)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
