// Tests for qa-prod-parity-coverage.mjs (spec-93 fase 4, review round 1
// Bloqueante 2). Run: node scripts/qa-prod-parity-coverage.test.mjs
import assert from 'node:assert/strict';
import { parseMeasurementFile } from './qa-prod-parity-compare.mjs';
import { parseBaseline } from './qa-prod-parity-baseline.mjs';
import { checkCoverage, summarizeExclusions, EXPECTED_SURFACES } from './qa-prod-parity-coverage.mjs';

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

test('EXPECTED_SURFACES lists every surface the two measurement scripts produce', () => {
  for (const s of ['auth', 'postgrest', 'edge_function', 'extensions', 'roles', 'gucs', 'cron_job', 'realtime_publication', 'storage_bucket', 'storage_policy']) {
    assert.ok(EXPECTED_SURFACES.includes(s), `missing ${s}`);
  }
});

test('checkCoverage flags a surface missing from QA specifically, not just "missing"', () => {
  const qa = parseMeasurementFile('');
  const prod = parseMeasurementFile('auth\tjwt_exp\t3600');
  const baseline = parseBaseline('');
  const gaps = checkCoverage(qa, prod, baseline, ['auth']);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].side, 'QA');
});

test('checkCoverage flags both sides independently when both are empty', () => {
  const qa = parseMeasurementFile('');
  const prod = parseMeasurementFile('');
  const baseline = parseBaseline('');
  const gaps = checkCoverage(qa, prod, baseline, ['auth']);
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps.map((g) => g.side).sort(), ['QA', 'production']);
});

test('checkCoverage does not flag surfaces outside the expected list', () => {
  const qa = parseMeasurementFile('auth\tjwt_exp\t3600');
  const prod = parseMeasurementFile('auth\tjwt_exp\t3600');
  const baseline = parseBaseline('');
  // "storage_bucket" is a real EXPECTED_SURFACES entry, but not passed here.
  const gaps = checkCoverage(qa, prod, baseline, ['auth']);
  assert.deepEqual(gaps, []);
});

test('summarizeExclusions returns one entry per declared exclusion, in declaration order', () => {
  const qa = parseMeasurementFile('');
  const prod = parseMeasurementFile('');
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "a"
  - id: some_other_surface
    reason: "b"
`);
  const summary = summarizeExclusions(qa, prod, baseline);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary.map((s) => s.id), ['kong_routes', 'some_other_surface']);
  assert.equal(summary[0].qaCount, 0);
  assert.equal(summary[0].prodCount, 0);
});

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
