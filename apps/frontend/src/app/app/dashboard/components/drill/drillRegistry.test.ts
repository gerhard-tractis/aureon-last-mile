import { describe, it, expect } from 'vitest';
import { drillRegistry, type DrillKey } from './drillRegistry';

const ALL_KEYS: DrillKey[] = ['fadr', 'late_reasons', 'region', 'customer'];

describe('drillRegistry', () => {
  it('has all 4 expected keys', () => {
    const keys = Object.keys(drillRegistry) as DrillKey[];
    expect(keys).toHaveLength(4);
    for (const key of ALL_KEYS) {
      expect(keys).toContain(key);
    }
  });

  it.each(ALL_KEYS)('entry "%s" has a title string', (key) => {
    const entry = drillRegistry[key];
    expect(typeof entry.title).toBe('string');
    expect(entry.title.length).toBeGreaterThan(0);
  });

  it.each(ALL_KEYS)('entry "%s" title is in Spanish (non-empty)', (key) => {
    const entry = drillRegistry[key];
    // Spanish titles should not be blank
    expect(entry.title.trim()).toBeTruthy();
  });

  it.each(ALL_KEYS)('entry "%s" has a content property (lazy component object)', (key) => {
    const entry = drillRegistry[key];
    // React.lazy() returns an object with $$typeof symbol
    expect(typeof entry.content).toBe('object');
    expect(entry.content).not.toBeNull();
  });

  it('fadr title matches "FADR — Motivos de no entrega"', () => {
    expect(drillRegistry['fadr'].title).toBe('FADR — Motivos de no entrega');
  });

  it('late_reasons title matches "Razones de retraso"', () => {
    expect(drillRegistry['late_reasons'].title).toBe('Razones de retraso');
  });

  it('region title matches "OTIF por región"', () => {
    expect(drillRegistry['region'].title).toBe('OTIF por región');
  });

  it('customer title matches "OTIF por cliente"', () => {
    expect(drillRegistry['customer'].title).toBe('OTIF por cliente');
  });
});
