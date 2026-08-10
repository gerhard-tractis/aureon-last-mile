import { describe, it, expect } from 'vitest';
import { parseArgs, CliError, SCENARIO_GROUPS } from './cli';

describe('parseArgs', () => {
  it('runs every scenario by default', () => {
    expect(parseArgs([]).scenarios).toEqual([...SCENARIO_GROUPS]);
  });

  it('defaults every mode flag to off', () => {
    const options = parseArgs([]);
    expect(options.reset).toBe(false);
    expect(options.dryRun).toBe(false);
    expect(options.verifyOnly).toBe(false);
    expect(options.count).toBeUndefined();
  });

  it('accepts --scenarios=all', () => {
    expect(parseArgs(['--scenarios=all']).scenarios).toEqual([...SCENARIO_GROUPS]);
  });

  it('accepts a comma-separated list', () => {
    expect(parseArgs(['--scenarios=outcomes,tenancy']).scenarios).toEqual(['outcomes', 'tenancy']);
  });

  it('treats --only as an alias', () => {
    expect(parseArgs(['--only=outcomes']).scenarios).toEqual(['outcomes']);
  });

  it('tolerates whitespace in the list', () => {
    expect(parseArgs(['--scenarios=outcomes, tenancy']).scenarios).toEqual(['outcomes', 'tenancy']);
  });

  it('rejects an unknown scenario by name', () => {
    expect(() => parseArgs(['--scenarios=nope'])).toThrow(/Unknown scenario\(s\): nope/);
  });

  it('rejects an empty scenario list', () => {
    expect(() => parseArgs(['--scenarios='])).toThrow(CliError);
  });

  it('parses the mode flags', () => {
    expect(parseArgs(['--reset']).reset).toBe(true);
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--verify']).verifyOnly).toBe(true);
  });

  it('parses --count', () => {
    expect(parseArgs(['--count=50']).count).toBe(50);
  });

  it.each(['--count=0', '--count=-1', '--count=1.5', '--count=abc'])(
    'rejects %s',
    (arg) => {
      expect(() => parseArgs([arg])).toThrow(/positive integer/);
    },
  );

  // Refusing beats guessing: --reset destroys data, so an ambiguous
  // combination must not be silently resolved.
  it('refuses --reset combined with --dry-run', () => {
    expect(() => parseArgs(['--reset', '--dry-run'])).toThrow(/cannot be combined/);
  });

  it('refuses --reset combined with --verify', () => {
    expect(() => parseArgs(['--reset', '--verify'])).toThrow(/cannot be combined/);
  });

  it('refuses --dry-run combined with --verify', () => {
    expect(() => parseArgs(['--dry-run', '--verify'])).toThrow(/mutually exclusive/);
  });

  it('rejects an unrecognised argument and shows usage', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unrecognised argument "--wat"/);
    expect(() => parseArgs(['--wat'])).toThrow(/Usage:/);
  });

  it('treats --help as a usage request', () => {
    expect(() => parseArgs(['--help'])).toThrow(/Usage:/);
    expect(() => parseArgs(['-h'])).toThrow(/Usage:/);
  });

  it('combines compatible flags', () => {
    const options = parseArgs(['--only=outcomes', '--count=10', '--dry-run']);
    expect(options).toMatchObject({
      scenarios: ['outcomes'],
      count: 10,
      dryRun: true,
      reset: false,
      verifyOnly: false,
    });
  });
});
