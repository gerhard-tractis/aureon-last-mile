// apps/frontend/src/lib/distribution/dock-capacity.test.ts
import { describe, it, expect } from 'vitest';
import { getDockCapacityStatus } from './dock-capacity';

describe('getDockCapacityStatus', () => {
  it('returns configured: false and no tone when capacity is null', () => {
    const status = getDockCapacityStatus(50, null);
    expect(status.configured).toBe(false);
    expect(status.fillPct).toBeNull();
    expect(status.tone).toBeNull();
    expect(status.remainingLabel).toBeNull();
  });

  it('treats capacity 0 the same as not configured', () => {
    const status = getDockCapacityStatus(0, 0);
    expect(status.configured).toBe(false);
    expect(status.fillPct).toBeNull();
  });

  it('treats negative capacity the same as not configured', () => {
    const status = getDockCapacityStatus(5, -10);
    expect(status.configured).toBe(false);
    expect(status.fillPct).toBeNull();
  });

  it('is neutral tone below 90% fill', () => {
    const status = getDockCapacityStatus(80, 100);
    expect(status.configured).toBe(true);
    expect(status.fillPct).toBe(80);
    expect(status.tone).toBe('neutral');
  });

  it('is neutral tone at exactly 89%', () => {
    const status = getDockCapacityStatus(89, 100);
    expect(status.tone).toBe('neutral');
  });

  it('is warning tone at exactly 90%', () => {
    const status = getDockCapacityStatus(90, 100);
    expect(status.tone).toBe('warning');
  });

  it('is warning tone between 90% and 100% (exclusive of 100)', () => {
    const status = getDockCapacityStatus(99, 100);
    expect(status.tone).toBe('warning');
  });

  it('is error tone at exactly 100%', () => {
    const status = getDockCapacityStatus(100, 100);
    expect(status.tone).toBe('error');
  });

  it('is error tone above 100% (overfilled)', () => {
    const status = getDockCapacityStatus(130, 100);
    expect(status.tone).toBe('error');
    // fill percentage is not clamped above 100 — the UI needs to know it's over
    expect(status.fillPct).toBe(130);
  });

  it('produces "quedan N espacios" with the correct remainder', () => {
    const status = getDockCapacityStatus(169, 180);
    expect(status.remainingLabel).toBe('Quedan 11 espacios');
  });

  it('clamps remaining spaces at 0 when count meets capacity', () => {
    const status = getDockCapacityStatus(100, 100);
    expect(status.remainingLabel).toBe('Quedan 0 espacios');
  });

  it('clamps remaining spaces at 0 when overfilled, never negative', () => {
    const status = getDockCapacityStatus(130, 100);
    expect(status.remainingLabel).toBe('Quedan 0 espacios');
  });

  it('uses singular copy when exactly 1 space remains', () => {
    const status = getDockCapacityStatus(99, 100);
    expect(status.remainingLabel).toBe('Queda 1 espacio');
  });

  it('treats a negative count as zero for fill purposes', () => {
    const status = getDockCapacityStatus(-5, 100);
    expect(status.fillPct).toBe(0);
    expect(status.tone).toBe('neutral');
    expect(status.remainingLabel).toBe('Quedan 100 espacios');
  });
});
