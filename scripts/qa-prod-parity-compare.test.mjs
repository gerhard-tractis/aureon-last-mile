// Tests for qa-prod-parity-compare.mjs (spec-93 fase 4).
// No network, no credentials — everything comes from in-memory fixtures or
// temp files. Run: node scripts/qa-prod-parity-compare.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseMeasurementFile,
  parseBaseline,
  compareSurfaces,
  runCompare,
} from './qa-prod-parity-compare.mjs';
import { checkCoverage, summarizeExclusions } from './qa-prod-parity-coverage.mjs';

const __filename = fileURLToPath(import.meta.url);
const COMPARE_SCRIPT = path.join(path.dirname(__filename), 'qa-prod-parity-compare.mjs');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.stack}`);
  }
}

// ── parseMeasurementFile ─────────────────────────────────────────────────
test('parseMeasurementFile reads surface\\tkey\\tvalue lines into a map', () => {
  const content = [
    'auth\tdisable_signup\ttrue',
    'auth\tjwt_exp\t3600',
    '# a comment, ignored',
    '',
    'extensions\tpostgis\t3.3.7',
  ].join('\n');
  const map = parseMeasurementFile(content);
  assert.equal(map.get('auth::disable_signup'), 'true');
  assert.equal(map.get('auth::jwt_exp'), '3600');
  assert.equal(map.get('extensions::postgis'), '3.3.7');
  assert.equal(map.size, 3);
});

test('parseMeasurementFile tolerates values containing tabs by only splitting twice', () => {
  const content = 'cron_job\tnightly-metrics\t0 2 * * *\tactive=true';
  const map = parseMeasurementFile(content);
  assert.equal(map.get('cron_job::nightly-metrics'), '0 2 * * *\tactive=true');
});

test('parseMeasurementFile rejects a malformed line instead of silently dropping it', () => {
  assert.throws(() => parseMeasurementFile('this line has no tabs at all'), /malformed/i);
});

test('parseMeasurementFile distinguishes an explicit empty-string value from a key that never appears', () => {
  // "" (the key IS present, with an empty value) and "absent from the file
  // entirely" are different findings, and the comparator's ABSENT sentinel
  // only applies to the second. This pins that distinction down explicitly.
  const withEmptyValue = parseMeasurementFile('auth\trefresh_token_rotation_enabled\t');
  assert.equal(withEmptyValue.get('auth::refresh_token_rotation_enabled'), '');
  assert.equal(withEmptyValue.has('auth::refresh_token_rotation_enabled'), true);

  const withoutTheKeyAtAll = parseMeasurementFile('# nothing for this key');
  assert.equal(withoutTheKeyAtAll.has('auth::refresh_token_rotation_enabled'), false);
});

// ── parseBaseline (re-exported) ──────────────────────────────────────────
test('parseBaseline reads excluded surfaces and accepted divergences', () => {
  const yaml = `
excluded_surfaces:
  - id: kong_routes
    reason: "prod is the managed gateway, not Kong"
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
    reason: "QA blocks self-signup on purpose"
    uncovered_change_class: "a change to production signup policy"
`;
  const baseline = parseBaseline(yaml);
  assert.ok(baseline.excludedSurfaces.has('kong_routes'));
  const entry = baseline.accepted.get('auth::disable_signup');
  assert.equal(entry.qa, 'true');
  assert.equal(entry.production, 'false');
  assert.ok(entry.reason.length > 0);
});

// ── compareSurfaces — the core diff ──────────────────────────────────────
test('compareSurfaces reports no findings when QA and prod match', () => {
  const qa = parseMeasurementFile('auth\tjwt_exp\t3600');
  const prod = parseMeasurementFile('auth\tjwt_exp\t3600');
  const baseline = parseBaseline('');
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.undeclared.length, 0);
  assert.equal(result.matched.length, 1);
});

test('compareSurfaces flags a divergence nobody declared', () => {
  const qa = parseMeasurementFile('auth\tdisable_signup\ttrue');
  const prod = parseMeasurementFile('auth\tdisable_signup\tfalse');
  const baseline = parseBaseline('');
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.undeclared.length, 1);
  assert.equal(result.undeclared[0].surface, 'auth');
  assert.equal(result.undeclared[0].key, 'disable_signup');
});

test('compareSurfaces accepts a divergence that exactly matches the baseline', () => {
  const qa = parseMeasurementFile('auth\tdisable_signup\ttrue');
  const prod = parseMeasurementFile('auth\tdisable_signup\tfalse');
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
    reason: "declared on purpose"
    uncovered_change_class: "signup policy changes"
`);
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.undeclared.length, 0);
  assert.equal(result.acceptedDivergences.length, 1);
});

test('compareSurfaces still flags a NEW divergence even when the baseline has an unrelated accepted one', () => {
  const qa = parseMeasurementFile(['auth\tdisable_signup\ttrue', 'auth\tjwt_exp\t7200'].join('\n'));
  const prod = parseMeasurementFile(['auth\tdisable_signup\tfalse', 'auth\tjwt_exp\t3600'].join('\n'));
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
    reason: "declared"
    uncovered_change_class: "x"
`);
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.undeclared.length, 1);
  assert.equal(result.undeclared[0].key, 'jwt_exp');
});

// review round 1, Bloqueante 4: this is the mutation-defeating test. The
// PREVIOUS "stale baseline" test below uses measured values that are equal
// to EACH OTHER, so it short-circuits on `qaVal === prodVal` before line
// 126's exact-match check ever runs — it never exercised that guard at all.
// This one has a REAL, ongoing divergence whose values have drifted away
// from what the baseline declared, which is exactly the case a mutant
// `if (declared)` (dropping the value-equality checks) would wrongly accept.
test('compareSurfaces flags an ONGOING divergence whose values drifted from the declared baseline pair', () => {
  // Baseline: qa=public, production="public, extensions". Reality now:
  // qa=public (unchanged), production="public, extensions, pgtap" (someone
  // added pgtap in prod). Still a real divergence, but NOT the one declared.
  const qa = parseMeasurementFile('postgrest\tdb_extra_search_path\tpublic');
  const prod = parseMeasurementFile('postgrest\tdb_extra_search_path\tpublic, extensions, pgtap');
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: postgrest
    key: db_extra_search_path
    qa: "public"
    production: "public, extensions"
    reason: "declared for a narrower search path"
    uncovered_change_class: "an unreviewed schema addition to prod's search path"
`);
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.acceptedDivergences.length, 0);
  assert.equal(result.undeclared.length, 1);
  assert.equal(result.undeclared[0].prodVal, 'public, extensions, pgtap');
  assert.equal(result.undeclared[0].declaredButStale, true);
});

test('compareSurfaces treats a stale baseline entry (values moved on) as a NEW undeclared divergence', () => {
  // Baseline says QA=true/prod=false, but QA has since flipped to "false" —
  // the measured pair no longer matches what was accepted, so this must not
  // pass silently just because the *key* was once declared.
  const qa = parseMeasurementFile('auth\tdisable_signup\tfalse');
  const prod = parseMeasurementFile('auth\tdisable_signup\tfalse');
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
    reason: "declared"
    uncovered_change_class: "x"
`);
  const result = compareSurfaces(qa, prod, baseline);
  // values now match (false === false) so this is not a divergence at all —
  // and the baseline entry itself is now stale (no longer reproduces).
  assert.equal(result.undeclared.length, 0);
  assert.equal(result.staleBaseline.length, 1);
});

test('compareSurfaces reports a key absent from one side entirely and still checks the baseline', () => {
  const prod = parseMeasurementFile('auth\trefresh_token_rotation_enabled\ttrue');
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: auth
    key: refresh_token_rotation_enabled
    qa: "<absent>"
    production: "true"
    reason: "declared"
    uncovered_change_class: "x"
`);
  const qaAbsent = parseMeasurementFile('# nothing for this key');
  const result = compareSurfaces(qaAbsent, prod, baseline);
  assert.equal(result.undeclared.length, 0);
  assert.equal(result.acceptedDivergences.length, 1);
});

test('compareSurfaces ignores a surface listed in excluded_surfaces entirely', () => {
  const qa = parseMeasurementFile('kong_routes\t/auth/v1/\tpresent');
  const prod = parseMeasurementFile('kong_routes\t/auth/v1/\tabsent');
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "prod is the managed gateway"
`);
  const result = compareSurfaces(qa, prod, baseline);
  assert.equal(result.undeclared.length, 0);
  assert.equal(result.matched.length, 0);
});

// ── checkCoverage / summarizeExclusions — re-exported from qa-prod-parity-coverage.mjs ─
test('checkCoverage reports no gaps when every expected surface has facts on both sides', () => {
  const qa = parseMeasurementFile('auth\tjwt_exp\t3600');
  const prod = parseMeasurementFile('auth\tjwt_exp\t3600');
  const baseline = parseBaseline('');
  const gaps = checkCoverage(qa, prod, baseline, ['auth']);
  assert.deepEqual(gaps, []);
});

test('checkCoverage flags an expected surface with zero facts on one side', () => {
  const qa = parseMeasurementFile('auth\tjwt_exp\t3600');
  const prod = parseMeasurementFile(''); // production produced nothing for "auth"
  const baseline = parseBaseline('');
  const gaps = checkCoverage(qa, prod, baseline, ['auth']);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].surface, 'auth');
  assert.equal(gaps[0].side, 'production');
});

test('checkCoverage exempts a surface the baseline excludes', () => {
  const qa = parseMeasurementFile('kong_routes\t/a/\tpresent');
  const prod = parseMeasurementFile(''); // prod never measures kong_routes at all
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "not comparable"
`);
  const gaps = checkCoverage(qa, prod, baseline, ['kong_routes']);
  assert.deepEqual(gaps, []);
});

test('summarizeExclusions counts silenced facts per side, even when zero', () => {
  const qa = parseMeasurementFile('kong_routes\t/a/\tpresent\nkong_routes\t/b/\tpresent');
  const prod = parseMeasurementFile('');
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "not comparable"
`);
  const summary = summarizeExclusions(qa, prod, baseline);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].qaCount, 2);
  assert.equal(summary[0].prodCount, 0);
  assert.equal(summary[0].reason, 'not comparable');
});

// ── runCompare — the CLI-facing entry point, and the artifact-absent guard ─
function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-prod-parity-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('runCompare exits 0 when everything matches', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.equal(result.exitCode, 0);
  });
});

test('runCompare exits 1 on an undeclared divergence', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(prodPath, 'auth\tjwt_exp\t7200\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /jwt_exp/);
  });
});

test('runCompare reports excluded surfaces and how many facts each silenced', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\nkong_routes\t/a/\tpresent\n');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(
      baselinePath,
      'excluded_surfaces:\n  - id: kong_routes\n    reason: "not comparable"\n'
    );
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.equal(result.exitCode, 0);
    assert.match(result.message, /kong_routes/);
    assert.match(result.message, /silenced 1 QA fact/);
    assert.match(result.message, /not comparable/);
  });
});

// THE guard the spec calls the single most important requirement of the
// phase: an absent (or empty) QA measurement must never read as "no
// divergences". It has to break, and say it could not measure QA.
test('runCompare exits non-zero (never 0) when the QA measurement file does not exist', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa-that-was-never-written.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
    assert.match(result.message, /could not measure QA|QA measurement/i);
    assert.doesNotMatch(result.message, /no divergence/i);
  });
});

test('runCompare exits non-zero when the QA measurement file exists but is empty', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, '');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
  });
});

test('runCompare exits non-zero when the production measurement file is missing too', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod-missing.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
  });
});

// review round 1, Bloqueante 2 — the coverage-floor mutation tests. A file
// that EXISTS and is non-empty but produces zero usable facts used to pass
// with "matched: 0", indistinguishable from a real clean comparison.
test('runCompare exits non-zero when a comment-only QA file measured zero facts', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, '# nothing\n');
    writeFileSync(prodPath, '# nothing\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
    assert.doesNotMatch(result.message, /^matched: 0$/m);
  });
});

test('runCompare exits non-zero when a one-byte QA file measured zero facts', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, '\n'); // exists, non-empty (1 byte), zero usable facts
    writeFileSync(prodPath, '\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth'] });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
  });
});

test('runCompare exits non-zero when one expected surface (of several) is entirely missing from one side', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n'); // no "extensions" facts at all
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\nextensions\tpostgis\t3.3.7\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath, expectedSurfaces: ['auth', 'extensions'] });
    assert.equal(result.exitCode, 3);
    assert.match(result.message, /extensions \(QA\)/);
  });
});

test('runCompare uses the full default EXPECTED_SURFACES list when none is passed', () => {
  // Real-shaped baseline call site (no override) against a minimal fixture
  // that only covers "auth" — must fail coverage on the other nine.
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath });
    assert.equal(result.exitCode, 3);
  });
});

// ── The CLI itself — a real subprocess, not just the exported function ────
// review round 1, Menores: the CLI block previously had no test at all. The
// regression this closes ("dead on Windows, exits 0 having compared
// nothing") is exactly the category this spec exists to catch, and it can
// only be caught by actually spawning the script the way the workflow does.
test('the CLI exits 1 on an undeclared divergence when invoked as a real subprocess', () => {
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(prodPath, 'auth\tjwt_exp\t7200\n');
    writeFileSync(baselinePath, '');
    const proc = spawnSync(
      process.execPath,
      [COMPARE_SCRIPT, '--qa', qaPath, '--prod', prodPath, '--baseline', baselinePath],
      { encoding: 'utf8' }
    );
    // Coverage floor uses the full default list here (no override on the CLI
    // path), so this asserts on "not 0" rather than the exact code — the
    // point of this test is that the process actually ran the comparison
    // instead of silently exiting 0, which is the regression that shipped.
    assert.notEqual(proc.status, 0);
    assert.match(proc.stdout, /jwt_exp|UNDECLARED|could not measure/);
  });
});

test('the CLI exits 2 when required flags are missing', () => {
  const proc = spawnSync(process.execPath, [COMPARE_SCRIPT], { encoding: 'utf8' });
  assert.equal(proc.status, 2);
});

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
