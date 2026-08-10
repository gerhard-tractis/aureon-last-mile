import { describe, it, expect } from 'vitest';
import {
  qaId,
  isGeneratedId,
  ScenarioGroup,
  GENERATED_PREFIX,
  FIXED_IDS,
} from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('qaId', () => {
  it('produces a syntactically valid UUID v4', () => {
    expect(qaId(ScenarioGroup.OUTCOMES, 1)).toMatch(UUID_V4);
  });

  it('is deterministic — same inputs, same id', () => {
    expect(qaId(ScenarioGroup.DISPATCH, 42)).toBe(qaId(ScenarioGroup.DISPATCH, 42));
  });

  it('separates groups so ids say which scenario built them', () => {
    expect(qaId(ScenarioGroup.PICKUP, 1)).not.toBe(qaId(ScenarioGroup.RETURNS, 1));
  });

  it('separates sequences within a group', () => {
    expect(qaId(ScenarioGroup.PICKUP, 1)).not.toBe(qaId(ScenarioGroup.PICKUP, 2));
  });

  it('encodes the group in the node segment', () => {
    // OUTCOMES is 0x0060, sequence 1 -> 0060 00000001
    expect(qaId(ScenarioGroup.OUTCOMES, 1)).toBe(`${GENERATED_PREFIX}006000000001`);
  });

  it('stays in the generator range, never the spec-48 baseline range', () => {
    for (const group of Object.values(ScenarioGroup).filter((v) => typeof v === 'number')) {
      const id = qaId(group as ScenarioGroup, 7);
      expect(id.startsWith(GENERATED_PREFIX)).toBe(true);
      expect(id.startsWith('00000000-0000-4000-8000-')).toBe(false);
    }
  });

  it('rejects a negative or non-integer sequence', () => {
    expect(() => qaId(ScenarioGroup.PICKUP, -1)).toThrow(RangeError);
    expect(() => qaId(ScenarioGroup.PICKUP, 1.5)).toThrow(RangeError);
  });

  it('rejects a sequence that would overflow the segment', () => {
    expect(() => qaId(ScenarioGroup.PICKUP, 0x1_0000_0000)).toThrow(RangeError);
    expect(() => qaId(ScenarioGroup.PICKUP, 0xffffffff)).not.toThrow();
  });

  it('generates no collisions across a realistic volume', () => {
    const ids = new Set<string>();
    const groups = Object.values(ScenarioGroup).filter((v) => typeof v === 'number');
    for (const group of groups) {
      for (let seq = 0; seq < 500; seq++) ids.add(qaId(group as ScenarioGroup, seq));
    }
    expect(ids.size).toBe(groups.length * 500);
  });
});

describe('isGeneratedId', () => {
  it('recognises ids from this generator', () => {
    expect(isGeneratedId(qaId(ScenarioGroup.TENANCY, 1))).toBe(true);
  });

  // The critical case: --reset must never delete the spec-48 baseline, which
  // create-qa-users.sh and the QA runbook both depend on.
  it('does not claim the spec-48 baseline operator', () => {
    expect(isGeneratedId(FIXED_IDS.BASELINE_OPERATOR)).toBe(false);
  });

  it('does not claim an arbitrary application UUID', () => {
    expect(isGeneratedId('92dc5797-047d-458d-bbdb-63f18c0dd1e7')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isGeneratedId(qaId(ScenarioGroup.TENANCY, 1).toUpperCase())).toBe(true);
  });
});

describe('FIXED_IDS', () => {
  it('keeps the baseline operator in the spec-48 range', () => {
    expect(FIXED_IDS.BASELINE_OPERATOR).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('puts the second and blank operators in the generator range', () => {
    expect(isGeneratedId(FIXED_IDS.SECOND_OPERATOR)).toBe(true);
    expect(isGeneratedId(FIXED_IDS.BLANK_OPERATOR)).toBe(true);
  });

  it('gives every fixed id a distinct value', () => {
    const values = Object.values(FIXED_IDS);
    expect(new Set(values).size).toBe(values.length);
  });
});
