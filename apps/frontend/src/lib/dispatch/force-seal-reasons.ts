/**
 * spec-77 — the closed reason vocabulary for `sealRoute`'s force path.
 *
 * Grepped the repo before inventing this, per the task brief: `removal_reason`
 * (spec-70 decision 3, `packages/[pkgId]/route.ts`), `adopted_reason`
 * (`scan/route.ts`), and Reception's `return_reason` / discrepancy notes
 * (spec-52/spec-56, `finalize-rule.ts`) are all free text with no closed set
 * behind any of them — there is nothing to reuse. So this is a new, small,
 * closed set, in the spirit of the short-shipping reason codes used
 * industry-wide (Infor/Oracle WMS "ship short" reasons): the crew is not
 * asked to write an essay, but a force-close with no code at all would let
 * "reason" degrade into decoration rather than an audited fact.
 *
 * Four operational causes, plus one escape hatch that still forces a note:
 *
 *   - `paquete_no_ubicado` — the box could not be located on the dock before
 *     cutoff. The dominant case: nothing is known to be wrong with the
 *     package, the crew simply could not find it in time.
 *   - `turno_terminado` — the shift/cutoff arrived before the remaining
 *     boxes could be scanned at all, independent of any one package's
 *     condition — a time problem, not a box problem.
 *   - `vehiculo_lleno` — the truck reached physical capacity before every
 *     planned box fit — a planning/capacity problem, not a missing-box one.
 *   - `paquete_dañado_en_anden` — the box was found but is damaged and was
 *     deliberately held back. Named to match the existing `dañado` package
 *     status (`package_status_enum`) rather than inventing a parallel word
 *     for the same fact.
 *   - `otro` — escape hatch for whatever the four above do not cover. A
 *     code that means "something else" cannot itself be the whole
 *     explanation, so the API layer requires a non-empty `note` whenever
 *     this is chosen.
 */
export const FORCE_SEAL_REASON_CODES = [
  'paquete_no_ubicado',
  'turno_terminado',
  'vehiculo_lleno',
  'paquete_dañado_en_anden',
  'otro',
] as const;

export type ForceSealReasonCode = (typeof FORCE_SEAL_REASON_CODES)[number];

export function isForceSealReasonCode(value: unknown): value is ForceSealReasonCode {
  return typeof value === 'string' && (FORCE_SEAL_REASON_CODES as readonly string[]).includes(value);
}
