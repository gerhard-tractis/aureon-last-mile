/**
 * qa-prod-parity-coverage.mjs — spec-93 fase 4: the coverage floor.
 *
 * Split out of qa-prod-parity-compare.mjs (review budget: 300 lines) — a
 * distinct concern, easier to test in isolation. Answers two questions the
 * key-by-key diff in qa-prod-parity-compare.mjs cannot answer by itself:
 *
 *   1. checkCoverage — did we actually measure everything we expect to?
 *      A file that exists, is non-empty, and still produces zero usable
 *      facts (a one-byte file, a file full of comments) used to pass with
 *      "matched: 0" — indistinguishable from a real, clean comparison
 *      (review round 1, Bloqueante 2). "Missing an artifact" isn't the only
 *      way to measure nothing.
 *   2. summarizeExclusions — what did the baseline's excluded_surfaces
 *      silence, and how much? An exclusion the report never mentions is
 *      indistinguishable from one that silences nothing (same finding).
 */

/**
 * Every surface scripts/measure-qa-surfaces.sh and scripts/measure-prod-surfaces.sh
 * are expected to produce at least one fact for, unless the baseline
 * excludes it.
 */
export const EXPECTED_SURFACES = [
  'auth',
  'postgrest',
  'edge_function',
  'extensions',
  'roles',
  'gucs',
  'cron_job',
  'realtime_publication',
  'storage_bucket',
  'storage_policy',
];

/** Recover {surface, key} pairs a flat map (built by parseMeasurementFile) covers. */
function structuredEntries(flatMap) {
  const structured = flatMap.entries2;
  return structured ? [...structured.values()] : [];
}

/**
 * Which expected surfaces produced ZERO facts on which side. Excluded
 * surfaces are exempt (there is nothing to expect from them). Returns []
 * when coverage is complete.
 */
export function checkCoverage(qaMap, prodMap, baseline, expectedSurfaces = EXPECTED_SURFACES) {
  const qaSurfaces = new Set(structuredEntries(qaMap).map((e) => e.surface));
  const prodSurfaces = new Set(structuredEntries(prodMap).map((e) => e.surface));
  const gaps = [];
  for (const surface of expectedSurfaces) {
    if (baseline.excludedSurfaces.has(surface)) continue;
    if (!qaSurfaces.has(surface)) gaps.push({ surface, side: 'QA' });
    if (!prodSurfaces.has(surface)) gaps.push({ surface, side: 'production' });
  }
  return gaps;
}

/**
 * How many facts each excluded surface silenced, on each side. Always
 * returns one entry per declared exclusion, even when the count is zero — a
 * zero is itself useful information (an exclusion nobody's measurement ever
 * produces anything for is inert, and that should be visible, not hidden).
 */
export function summarizeExclusions(qaMap, prodMap, baseline) {
  const summary = [];
  for (const [id, declared] of baseline.excludedSurfaces) {
    const qaCount = structuredEntries(qaMap).filter((e) => e.surface === id).length;
    const prodCount = structuredEntries(prodMap).filter((e) => e.surface === id).length;
    summary.push({ id, reason: declared.reason, qaCount, prodCount });
  }
  return summary;
}
