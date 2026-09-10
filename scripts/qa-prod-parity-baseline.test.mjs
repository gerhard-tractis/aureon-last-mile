// Tests for qa-prod-parity-baseline.mjs (spec-93 fase 4).
// Run: node scripts/qa-prod-parity-baseline.test.mjs
import assert from 'node:assert/strict';
import { parseBaseline } from './qa-prod-parity-baseline.mjs';

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

test('parseBaseline on an empty file returns no exclusions and no accepted divergences', () => {
  const baseline = parseBaseline('');
  assert.equal(baseline.excludedSurfaces.size, 0);
  assert.equal(baseline.accepted.size, 0);
});

test('parseBaseline reads multiple excluded surfaces', () => {
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "prod is the managed gateway, not Kong"
  - id: realtime_messages_partitions
    reason: "date-named daily partitions — pure noise"
`);
  assert.ok(baseline.excludedSurfaces.has('kong_routes'));
  assert.ok(baseline.excludedSurfaces.has('realtime_messages_partitions'));
  assert.equal(baseline.excludedSurfaces.size, 2);
});

test('parseBaseline rejects an excluded_surfaces entry with no reason', () => {
  assert.throws(
    () => parseBaseline('excluded_surfaces:\n  - id: kong_routes\n'),
    /reason/i
  );
});

test('parseBaseline rejects a totally malformed line rather than silently ignoring it', () => {
  assert.throws(() => parseBaseline('not: valid: at: all: :: nope'), /could not parse/i);
});

test('parseBaseline keys accepted divergences by surface::key so lookups are unambiguous', () => {
  const baseline = parseBaseline(`
accepted_divergences:
  - surface: auth
    key: mfa_totp_enroll_enabled
    qa: "<absent>"
    production: "true"
    reason: "QA never declared MFA enrollment"
    uncovered_change_class: "a change to MFA enrollment policy"
`);
  const entry = baseline.accepted.get('auth::mfa_totp_enroll_enabled');
  assert.equal(entry.qa, '<absent>');
  assert.equal(entry.production, 'true');
  assert.equal(entry.uncoveredChangeClass, 'a change to MFA enrollment policy');
});

// review round 1, Bloqueante 4: `uncovered_change_class` was implemented as
// required but had no test pinning it down — the reviewer mutated the
// required-fields list to drop it and zero tests caught it. This is that test.
test('parseBaseline rejects an accepted_divergences entry missing uncovered_change_class', () => {
  assert.throws(
    () =>
      parseBaseline(`
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: "true"
    production: "false"
    reason: "declared on purpose"
`),
    /uncovered_change_class/i
  );
});

// review round 1, Menores: single-quoted values used to survive as the
// literal string "'true'" (quotes included) and silently never match.
test('parseBaseline strips single quotes the same way it strips double quotes', () => {
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: 'single-quoted reason'
accepted_divergences:
  - surface: auth
    key: disable_signup
    qa: 'true'
    production: 'false'
    reason: 'single-quoted reason'
    uncovered_change_class: 'single-quoted class'
`);
  assert.equal(baseline.excludedSurfaces.get('kong_routes').reason, 'single-quoted reason');
  const entry = baseline.accepted.get('auth::disable_signup');
  assert.equal(entry.qa, 'true');
  assert.equal(entry.production, 'false');
});

// review round 1, Bloqueante 2: the comparator has to report every
// exclusion's reason, not just silently skip the surface — that requires
// the reason to survive parsing, not just the id.
test('parseBaseline keeps the reason alongside each excluded surface, not just its id', () => {
  const baseline = parseBaseline(`
excluded_surfaces:
  - id: kong_routes
    reason: "prod is the managed gateway, not Kong"
`);
  assert.equal(baseline.excludedSurfaces.get('kong_routes').reason, 'prod is the managed gateway, not Kong');
});

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
