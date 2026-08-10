/**
 * spec-51 — QA scenario seed generator.
 *
 * Populates the spec-48 QA database with named scenarios covering the states
 * the workflows in docs/qa-test-scope.md need, then asserts the database
 * derived what each scenario intended.
 *
 * Run on the VPS against the QA stack only:
 *   npm run seed:qa -- --scenarios=all
 *
 * See docs/qa-environment.md for setup and reset.
 */

import { parseArgs, CliError, type CliOptions } from './lib/cli';
import { connect, assertEnumsMatch, type SeedClient } from './lib/db';
import { AssertionCollector } from './lib/assert';
import { GENERATED_LIKE_PATTERN } from './lib/ids';
import { seedOutcomes } from './scenarios/outcomes';
import { seedTenancy } from './scenarios/tenancy';

/**
 * Tables cleared by --reset, child-first so foreign keys stay satisfied.
 * Only rows in the generator's UUID range are touched — the spec-48 baseline
 * from seed-qa.sql is left alone.
 */
const RESET_TABLES = ['packages', 'orders', 'operator_enabled_modules', 'operators'] as const;

async function runReset(db: SeedClient): Promise<void> {
  console.log('Deleting rows created by this generator...\n');

  for (const table of RESET_TABLES) {
    // operator_enabled_modules has no generated id of its own — it is removed
    // by operator, so the two operators this generator created take their
    // module rows with them.
    const column = table === 'operator_enabled_modules' ? 'operator_id' : 'id';
    const rows = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM public.${table} WHERE ${column}::text LIKE $1 RETURNING 1
       ) SELECT count(*) AS count FROM deleted`,
      [GENERATED_LIKE_PATTERN],
    );
    console.log(`  ${table.padEnd(26)} ${rows[0]?.count ?? 0} row(s)`);
  }

  console.log('\nThe spec-48 baseline from seed-qa.sql was not touched.');
}

async function runScenarios(
  db: SeedClient,
  options: CliOptions,
  collector: AssertionCollector,
): Promise<void> {
  for (const scenario of options.scenarios) {
    process.stdout.write(`  ${scenario.padEnd(12)} `);

    const created =
      scenario === 'outcomes'
        ? await seedOutcomes(db, collector)
        : await seedTenancy(db, collector);

    console.log(`${created} order(s)`);
  }
}

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof CliError ? error.message : error);
    return 1;
  }

  if (options.dryRun) {
    console.log('Dry run — nothing will be written.\n');
    console.log(`Would run: ${options.scenarios.join(', ')}`);
    console.log(`Target:    localhost:5433 (enforced)`);
    return 0;
  }

  const db = await connect();

  try {
    // Before anything else: a string comparison against an enum fails quietly,
    // so confirm the database's enums are what this generator expects.
    await assertEnumsMatch(db);
    console.log('Enum check passed — generator literals match the database.\n');

    if (options.reset) {
      await runReset(db);
      return 0;
    }

    const collector = new AssertionCollector();

    if (options.verifyOnly) {
      console.log('Verify only — re-running assertions against existing data.\n');
    }

    await runScenarios(db, options, collector);

    console.log(`\n${collector.format()}`);
    return collector.passed ? 0 : 1;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
