import { describe, it, expect } from 'vitest';
import { civilDateOf } from './civil-date';

describe('civilDateOf', () => {
  it('reads the Santiago civil date, not a UTC slice, just after UTC midnight', () => {
    // 02:30 UTC is still the previous evening in Santiago (UTC-3/-4 either
    // way) — a UTC slice of this ISO string would read '2026-09-03', one
    // day ahead of the real Chilean date. spec-76 M3: this is the exact
    // regression `crew-board.test.ts`'s old `civilDateOf` stub (a bare
    // `.slice(0, 10)`) could never catch.
    expect(civilDateOf('2026-09-03T02:30:00Z')).toBe('2026-09-02');
  });

  it('agrees with the UTC date well inside the Chilean day', () => {
    expect(civilDateOf('2026-09-03T18:00:00Z')).toBe('2026-09-03');
  });
});
