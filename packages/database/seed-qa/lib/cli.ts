/**
 * spec-51 — argument parsing for the QA seed CLI.
 * Pure, so it is unit-testable without a database.
 */

export const SCENARIO_GROUPS = ['matrix', 'journeys', 'outcomes', 'tenancy', 'pickup'] as const;
export type ScenarioName = (typeof SCENARIO_GROUPS)[number];

export interface CliOptions {
  /** Scenario groups to run. */
  scenarios: ScenarioName[];
  /** Delete generated rows instead of creating them. */
  reset: boolean;
  /** Report what would happen, write nothing. */
  dryRun: boolean;
  /** Re-run assertions against existing data, insert nothing. */
  verifyOnly: boolean;
  /** Per-scenario volume multiplier, where a scenario supports it. */
  count?: number;
}

export class CliError extends Error {}

export const USAGE = `
Usage: npm run seed:qa -- [options]

  --scenarios=all|<a,b>   scenario groups to run (default: all)
  --only=<a,b>            alias for --scenarios
  --count=<n>             volume multiplier where supported
  --reset                 delete rows created by this generator, then stop
  --dry-run               report the plan, write nothing
  --verify                re-run assertions against existing data
  --help                  this message

Available scenarios: ${SCENARIO_GROUPS.join(', ')}

Only ever runs against the QA database on localhost:5433. See
docs/qa-environment.md for the tunnel and reset procedure.
`.trim();

function parseScenarioList(value: string): ScenarioName[] {
  if (value === 'all') return [...SCENARIO_GROUPS];

  const requested = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new CliError('No scenarios given. Use --scenarios=all or a comma-separated list.');
  }

  const unknown = requested.filter(
    (name) => !(SCENARIO_GROUPS as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    throw new CliError(
      `Unknown scenario(s): ${unknown.join(', ')}. Available: ${SCENARIO_GROUPS.join(', ')}`,
    );
  }

  return requested as ScenarioName[];
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scenarios: [...SCENARIO_GROUPS],
    reset: false,
    dryRun: false,
    verifyOnly: false,
  };

  for (const arg of argv) {
    if (arg === '--reset') {
      options.reset = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verify') {
      options.verifyOnly = true;
    } else if (arg.startsWith('--scenarios=') || arg.startsWith('--only=')) {
      options.scenarios = parseScenarioList(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--count=')) {
      const count = Number(arg.slice('--count='.length));
      if (!Number.isInteger(count) || count < 1) {
        throw new CliError(`--count must be a positive integer, got "${arg}"`);
      }
      options.count = count;
    } else if (arg === '--help' || arg === '-h') {
      throw new CliError(USAGE);
    } else {
      throw new CliError(`Unrecognised argument "${arg}".\n\n${USAGE}`);
    }
  }

  // --reset deletes and stops; combining it with a write mode is ambiguous
  // enough that guessing would be worse than refusing.
  if (options.reset && (options.dryRun || options.verifyOnly)) {
    throw new CliError('--reset cannot be combined with --dry-run or --verify.');
  }

  if (options.dryRun && options.verifyOnly) {
    throw new CliError('--dry-run and --verify are mutually exclusive.');
  }

  return options;
}
