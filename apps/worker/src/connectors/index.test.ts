import { describe, it, expect } from 'vitest';
import { connectors } from './index';

describe('connectors registry', () => {
  it('has csv_email connector', () => {
    expect(connectors.csv_email).toBeDefined();
    expect(typeof connectors.csv_email).toBe('function');
  });

  it('has browser connector registered', () => {
    expect(connectors.browser).toBeDefined();
    expect(typeof connectors.browser).toBe('function');
  });
});
