#!/usr/bin/env node
/**
 * qa-prod-parity-compare.mjs — spec-93 fase 4: the deterministic guardrail.
 *
 * Compares two "measurement files" (QA's live config surfaces vs
 * production's) against a baseline of *declared* accepted divergences, and
 * fails when it finds one that isn't declared. The precedent of shape is
 * scripts/verify-prod-migrations.sh (spec-87): a script that compares two
 * environments and breaks the build, kept pure and testable without network
 * or credentials by reading its inputs from files instead of talking to
 * anything itself. Collection (docker inspect on the VPS, psql/curl against
 * the Supabase Management API) is the workflows' job — see
 * .github/workflows/qa-prod-parity.yml.
 *
 * MEASUREMENT FILE FORMAT
 * ------------------------
 * Plain text, one fact per line: `<surface>\t<key>\t<value>`. Blank lines and
 * lines starting with `#` are ignored. `value` may itself contain tabs (a
 * cron schedule, a policy role list) — only the first two tabs are treated as
 * separators. A key absent from a file means "not observed on that side",
 * not "empty string" — the two are different findings (see the `<absent>`
 * sentinel below).
 *
 * BASELINE FORMAT (YAML)
 * -----------------------
 *   excluded_surfaces:
 *     - id: kong_routes
 *       reason: "..."
 *   accepted_divergences:
 *     - surface: auth
 *       key: disable_signup
 *       qa: "true"
 *       production: "false"
 *       reason: "..."
 *       uncovered_change_class: "..."
 *
 * An accepted_divergences entry only silences a finding when its declared
 * qa/production values match EXACTLY what was measured. If the measured
 * values have moved on since the baseline was written, that is NOT the
 * declared divergence anymore — it is reported as a fresh, undeclared one,
 * and the stale baseline entry is reported separately (a warning, not a
 * failure: a divergence that closed on its own is not the danger this file
 * exists to catch).
 *
 * THE SINGLE MOST IMPORTANT GUARD IN THIS FILE
 * -----------------------------------------------
 * A missing or empty QA (or production) measurement file must NEVER be read
 * as "zero surfaces, nothing to report" — that is exactly the failure mode
 * spec-93 exists to close: a green check that verified nothing. runCompare
 * refuses to compare at all in that case and exits 3, with a message that
 * says it could not measure — never a message that could be mistaken for "no
 * divergence found". See qa-prod-parity-compare.test.mjs for the mutation
 * tests that pin this down.
 *
 * THE SECOND GUARD: A COVERAGE FLOOR — review round 1, Bloqueante 2
 * -----------------------------------------------------------------
 * "Missing file" isn't the only way to measure nothing. A file that exists,
 * is non-empty, and STILL produces zero usable facts (a one-byte file, a
 * file full of comments) used to pass with `matched: 0` — indistinguishable
 * from a real, clean comparison. EXPECTED_SURFACES names every surface this
 * guardrail is supposed to see facts about (minus whatever the baseline
 * explicitly excludes); if either side produced zero facts for a
 * non-excluded expected surface, that is ALSO "could not measure", not "no
 * divergence" — same exit code 3 as a missing file, for the same reason.
 *
 * EXIT CODES
 *   0  every divergence found is declared in the baseline (or there are none)
 *   1  an undeclared divergence exists
 *   2  usage error (bad CLI args) or a malformed baseline
 *   3  a measurement file is missing/empty, OR produced zero facts for an
 *      expected, non-excluded surface — parity could not be checked
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseBaseline, KEY_SEP } from './qa-prod-parity-baseline.mjs';
import { EXPECTED_SURFACES, checkCoverage, summarizeExclusions } from './qa-prod-parity-coverage.mjs';

export { parseBaseline, EXPECTED_SURFACES, checkCoverage, summarizeExclusions };

const ABSENT = '<absent>';

export function parseMeasurementFile(content) {
  const map = new Map();
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const firstTab = line.indexOf('\t');
    const secondTab = firstTab === -1 ? -1 : line.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) {
      throw new Error(`malformed measurement line (expected surface\\tkey\\tvalue): ${JSON.stringify(line)}`);
    }
    const surface = line.slice(0, firstTab);
    const key = line.slice(firstTab + 1, secondTab);
    const value = line.slice(secondTab + 1);
    map.set(surface + KEY_SEP + key, { surface, key, value });
  }
  // Store a flat value-lookup on the same map for convenience in tests that
  // only care about the value, while keeping surface/key recoverable.
  const flat = new Map();
  for (const [k, v] of map) flat.set(k, v.value);
  flat.entries2 = map; // structured access for compareSurfaces
  return flat;
}

/** Recover {surface, key} pairs a flat map (built by parseMeasurementFile) covers. */
function structuredEntries(flatMap) {
  const structured = flatMap.entries2;
  return structured ? [...structured.values()] : [];
}

export function compareSurfaces(qaMap, prodMap, baseline) {
  const bySurfaceKey = new Map();
  for (const entry of structuredEntries(qaMap)) {
    bySurfaceKey.set(entry.surface + KEY_SEP + entry.key, { surface: entry.surface, key: entry.key });
  }
  for (const entry of structuredEntries(prodMap)) {
    bySurfaceKey.set(entry.surface + KEY_SEP + entry.key, { surface: entry.surface, key: entry.key });
  }

  const matched = [];
  const acceptedDivergences = [];
  const undeclared = [];
  const seenAcceptedKeys = new Set();

  for (const { surface, key } of bySurfaceKey.values()) {
    if (baseline.excludedSurfaces.has(surface)) continue;

    const combinedKey = surface + KEY_SEP + key;
    const qaVal = qaMap.has(combinedKey) ? qaMap.get(combinedKey) : ABSENT;
    const prodVal = prodMap.has(combinedKey) ? prodMap.get(combinedKey) : ABSENT;

    if (qaVal === prodVal) {
      matched.push({ surface, key, value: qaVal });
      continue;
    }

    const declared = baseline.accepted.get(combinedKey);
    if (declared && declared.qa === qaVal && declared.production === prodVal) {
      acceptedDivergences.push({ ...declared, qaVal, prodVal });
      seenAcceptedKeys.add(combinedKey);
      continue;
    }

    undeclared.push({
      surface,
      key,
      qaVal,
      prodVal,
      declaredButStale: Boolean(declared),
    });
  }

  const staleBaseline = [];
  for (const [combinedKey, declared] of baseline.accepted) {
    if (seenAcceptedKeys.has(combinedKey)) continue;
    // Either the key no longer appears on either side, or it appears but the
    // measured values now match (so it is not a divergence anymore) — both
    // mean the baseline entry no longer describes reality.
    const stillDiverges = undeclared.some((u) => u.surface + KEY_SEP + u.key === combinedKey && u.declaredButStale);
    if (!stillDiverges) staleBaseline.push(declared);
  }

  return { matched, acceptedDivergences, undeclared, staleBaseline };
}

function readMeasurementFileOrFail(pathLabel, filePath) {
  if (!existsSync(filePath) || statSync(filePath).size === 0) {
    return { ok: false, reason: `${pathLabel} measurement is missing or empty: ${filePath}` };
  }
  return { ok: true, content: readFileSync(filePath, 'utf8') };
}

export function runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces = EXPECTED_SURFACES }) {
  const qaRead = readMeasurementFileOrFail('QA', qaPath);
  const prodRead = readMeasurementFileOrFail('production', prodPath);

  if (!qaRead.ok || !prodRead.ok) {
    const reasons = [qaRead.ok ? null : qaRead.reason, prodRead.ok ? null : prodRead.reason].filter(Boolean);
    return {
      exitCode: 3,
      message:
        `could not measure QA/production parity — ${reasons.join('; ')}. ` +
        'This is a hard failure of the parity check itself — an absent measurement means nothing was compared, not that everything matched.',
    };
  }

  let baseline;
  try {
    baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    return { exitCode: 2, message: `baseline is malformed: ${err.message}` };
  }

  const qaMap = parseMeasurementFile(qaRead.content);
  const prodMap = parseMeasurementFile(prodRead.content);

  const gaps = checkCoverage(qaMap, prodMap, baseline, expectedSurfaces);
  if (gaps.length > 0) {
    const gapList = gaps.map((g) => `${g.surface} (${g.side})`).join(', ');
    return {
      exitCode: 3,
      message:
        `could not measure QA/production parity — these expected surfaces produced ZERO facts: ${gapList}. ` +
        'A file that exists but measured nothing is the same failure as a missing file — it is not "no divergence found".',
    };
  }

  const result = compareSurfaces(qaMap, prodMap, baseline);
  const exclusions = summarizeExclusions(qaMap, prodMap, baseline);

  const lines = [];
  if (exclusions.length > 0) {
    lines.push(`excluded surfaces (declared in baseline, never compared):`);
    for (const e of exclusions) {
      lines.push(`  - ${e.id}: silenced ${e.qaCount} QA fact(s), ${e.prodCount} production fact(s) — ${e.reason}`);
    }
  }
  lines.push(`matched: ${result.matched.length}`);
  lines.push(`accepted divergences (declared in baseline): ${result.acceptedDivergences.length}`);
  for (const d of result.acceptedDivergences) {
    lines.push(`  - ${d.surface}/${d.key}: qa=${d.qaVal} prod=${d.prodVal} — ${d.reason}`);
  }
  if (result.staleBaseline.length > 0) {
    lines.push(`::warning::${result.staleBaseline.length} baseline entr${result.staleBaseline.length === 1 ? 'y no' : 'ies no'} longer reproduce — consider pruning docs/qa-prod-parity-baseline.yml:`);
    for (const s of result.staleBaseline) {
      lines.push(`  - ${s.surface}/${s.key} (declared qa=${s.qa} prod=${s.production})`);
    }
  }
  if (result.undeclared.length > 0) {
    lines.push(`UNDECLARED divergences: ${result.undeclared.length}`);
    for (const u of result.undeclared) {
      const staleNote = u.declaredButStale ? ' (a baseline entry exists for this key but its values no longer match what was measured)' : '';
      lines.push(`  - ${u.surface}/${u.key}: qa=${u.qaVal} prod=${u.prodVal}${staleNote}`);
    }
  }

  return {
    exitCode: result.undeclared.length > 0 ? 1 : 0,
    message: lines.join('\n'),
  };
}

function parseArgv(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--qa') args.qaPath = value;
    else if (flag === '--prod') args.prodPath = value;
    else if (flag === '--baseline') args.baselinePath = value;
  }
  return args;
}

// pathToFileURL handles Windows drive-letter paths correctly (file:///C:/...);
// a hand-built `file://${path}` string does not, and silently produces a URL
// that never equals import.meta.url — which made this whole CLI block dead
// code on Windows the first time it was written. Caught by hand, not by a
// test: see qa-prod-parity-compare.test.mjs's note on why this matters, and
// why no test here can safely assert on process.argv[1]/import.meta.url
// without becoming a test of node's module loader instead of this file.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { qaPath, prodPath, baselinePath } = parseArgv(process.argv.slice(2));
  if (!qaPath || !prodPath || !baselinePath) {
    console.error('qa-prod-parity-compare: uso: node qa-prod-parity-compare.mjs --qa <file> --prod <file> --baseline <file>');
    process.exit(2);
  }
  const result = runCompare({ qaPath, prodPath, baselinePath });
  console.log(result.message);
  process.exit(result.exitCode);
}
