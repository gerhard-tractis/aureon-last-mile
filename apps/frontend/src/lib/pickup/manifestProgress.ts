/**
 * spec-54 phase 4.6 — shared, pure helpers for manifest verification
 * progress. Centralised because the same NULL-handling bug
 * (`verified_count < (total_packages ?? 0)` reading an unknown total as
 * zero, so an un-intake'd manifest silently looks "complete") showed up
 * independently in the page, the next-manifest card and the manifest list.
 * `total_packages` is nullable on `manifests` (OCR/manual intake does not
 * guarantee it) — null means UNKNOWN, never zero.
 */

interface ManifestTotals {
  verified_count: number;
  total_packages: number | null;
}

/**
 * A manifest is only "complete" when it HAS a positive total and verified
 * reached it. `total_packages: 0` is deliberately treated the same as
 * `null` here (not-complete) rather than "0 of 0, trivially done" — this
 * matches `RouteManifestList`'s pre-existing predicate
 * (`expected > 0 && verified >= expected`), which this function replaces.
 * In practice a manifest never legitimately expects zero packages; a 0
 * reads as intake not having recorded a count yet, not as an empty load.
 * Reading it as "complete" would make an un-intake'd manifest disappear
 * from "next to verify" exactly like the null case this fix targets.
 */
export function isManifestComplete(m: ManifestTotals): boolean {
  return (
    m.total_packages != null && m.total_packages > 0 && m.verified_count >= m.total_packages
  );
}

/** Renders a known total as-is; an unknown one as an em dash, never as 0. */
export function expectedLabel(totalPackages: number | null): string {
  return totalPackages == null ? '—' : String(totalPackages);
}

/** "3/8" when the total is known, "5/—" when it is not. */
export function progressLabel(m: ManifestTotals): string {
  return `${m.verified_count}/${expectedLabel(m.total_packages)}`;
}

export interface RouteExpectedTotals {
  /** Sum of total_packages across manifests that HAVE one. Partial by
   *  definition when hasUnknownExpected is true — never present it alone
   *  as "the route's total" in that case. */
  knownExpectedSum: number;
  /** True when at least one manifest has no total_packages yet. */
  hasUnknownExpected: boolean;
}

export function sumExpected(manifests: { total_packages: number | null }[]): RouteExpectedTotals {
  let knownExpectedSum = 0;
  let hasUnknownExpected = false;
  for (const m of manifests) {
    if (m.total_packages == null) {
      hasUnknownExpected = true;
    } else {
      knownExpectedSum += m.total_packages;
    }
  }
  return { knownExpectedSum, hasUnknownExpected };
}
