import { describe, it, expect } from 'vitest';
import packageJson from '../package.json';

describe('PWA Dependencies', () => {
  it('should have @serwist/next installed at ^9.5.5', () => {
    expect(packageJson.dependencies['@serwist/next']).toBe('^9.5.5');
  });

  it('should have serwist installed at ^9.5.5', () => {
    expect(packageJson.devDependencies['serwist']).toBe('^9.5.5');
  });

  it('should have dexie installed at ^4.3.0', () => {
    expect(packageJson.dependencies['dexie']).toBe('^4.3.0');
  });

  it('should have fake-indexeddb installed at ^6.2.5', () => {
    expect(packageJson.devDependencies['fake-indexeddb']).toBe('^6.2.5');
  });
});
