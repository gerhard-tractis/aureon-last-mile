import { describe, it, expect } from 'vitest';
import { attemptEscalationCopy, ESCALATION_ATTEMPT_THRESHOLD } from './dispatch-attempt-copy';

describe('attemptEscalationCopy — item 14, client-side attempt counter', () => {
  it('says nothing for the first two attempts', () => {
    expect(attemptEscalationCopy(1)).toBeNull();
    expect(attemptEscalationCopy(2)).toBeNull();
  });

  it('at the third attempt, the copy derives to the shift lead', () => {
    const copy = attemptEscalationCopy(3);
    expect(copy).not.toBeNull();
    expect(copy).toMatch(/jefe de turno/i);
    expect(copy).toMatch(/3/);
  });

  it('stays escalated on later attempts, not just exactly the third', () => {
    expect(attemptEscalationCopy(4)).toMatch(/jefe de turno/i);
  });

  it('the threshold is exposed, not a magic number duplicated by callers', () => {
    expect(ESCALATION_ATTEMPT_THRESHOLD).toBe(3);
  });
});
