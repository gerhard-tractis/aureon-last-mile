import { describe, it, expect } from 'vitest';
import { MODULES, ModuleKey, ALL_MODULE_KEYS, isValidModuleKey } from './registry';

describe('module registry (spec-45)', () => {
  it('exposes every ModuleKey value in MODULES', () => {
    for (const key of Object.values(ModuleKey)) {
      expect(MODULES[key as ModuleKey]).toBeDefined();
      expect(MODULES[key as ModuleKey].label.length).toBeGreaterThan(0);
    }
  });

  it('ALL_MODULE_KEYS lists every key exactly once', () => {
    expect(new Set(ALL_MODULE_KEYS).size).toBe(ALL_MODULE_KEYS.length);
    expect(ALL_MODULE_KEYS).toContain(ModuleKey.OPS_CONTROL);
    expect(ALL_MODULE_KEYS).toContain(ModuleKey.PICKUP);
  });

  it('does NOT include "admin" — admin is always-on infrastructure', () => {
    expect(Object.values(ModuleKey)).not.toContain('admin');
  });

  it('isValidModuleKey accepts known keys, rejects unknown', () => {
    expect(isValidModuleKey('pickup')).toBe(true);
    expect(isValidModuleKey('admin')).toBe(false);
    expect(isValidModuleKey('rogue')).toBe(false);
  });
});
