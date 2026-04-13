import { describe, it, expect } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('converts basic string to kebab-case', () => {
    expect(slugify('My Client')).toBe('my-client');
  });

  it('normalizes accented characters', () => {
    expect(slugify('Logística Rápida')).toBe('logistica-rapida');
  });

  it('removes special characters', () => {
    expect(slugify('Client & Sons (LLC)')).toBe('client-sons-llc');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify(' -hello- ')).toBe('hello');
  });
});
