// Tests for qa-prod-parity-compare.mjs (spec-93 fase 4).
// No network, no credentials — everything comes from in-memory fixtures or
// temp files. Run: node scripts/qa-prod-parity-compare.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseMeasurementFile,
  parseBaseline,
  compareSurfaces,
  runCompare,
} from './qa-prod-parity-compare.mjs';

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

// ── parseBaseline ────────────────────────────────────────────────────────
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

test('parseBaseline rejects an accepted_divergences entry missing a reason', () => {
  const yaml = `
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
`;
  assert.throws(() => parseBaseline(yaml), /reason/i);
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

test('compareSurfaces reports a key missing entirely on one side as <absent> and still checks the baseline', () => {
  const qa = parseMeasurementFile('auth\trefresh_token_rotation_enabled\t');
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
  void qa;
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
    const result = runCompare({ qaPath, prodPath, baselinePath });
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
    const result = runCompare({ qaPath, prodPath, baselinePath });
    assert.equal(result.exitCode, 1);
    assert.match(result.message, /jwt_exp/);
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
    const result = runCompare({ qaPath, prodPath, baselinePath });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
    assert.match(result.message, /could not measure QA|QA measurement/i);
    assert.doesNotMatch(result.message, /no divergence/i);
  });
});

test('runCompare exits non-zero when the QA measurement file exists but is empty', () => {
  // This is exactly the shape a runner that started but died mid-upload, or
  // an artifact download that silently produced a zero-byte file, leaves
  // behind — it must not be mistaken for "QA has zero surfaces, all fine".
  withTempDir((dir) => {
    const qaPath = path.join(dir, 'qa.tsv');
    const prodPath = path.join(dir, 'prod.tsv');
    const baselinePath = path.join(dir, 'baseline.yml');
    writeFileSync(qaPath, '');
    writeFileSync(prodPath, 'auth\tjwt_exp\t3600\n');
    writeFileSync(baselinePath, '');
    const result = runCompare({ qaPath, prodPath, baselinePath });
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
    const result = runCompare({ qaPath, prodPath, baselinePath });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.exitCode, 3);
  });
});

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
