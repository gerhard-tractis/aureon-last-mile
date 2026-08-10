# QA scenario seed generator (spec-51)

Populates the spec-48 QA database with named scenarios, then **asserts the
database derived what each scenario intended**. That second half is the point:
`orders.status` is computed by `trg_recalculate_order_status` from package
statuses, so placing rows proves nothing on its own.

Run on the VPS, against the QA stack only. See `docs/qa-environment.md` for
setup and `docs/qa-test-scope.md` for the workflows this data supports.

## Usage

```bash
npm run seed:qa -- --scenarios=all      # create everything
npm run seed:qa -- --only=outcomes      # one group
npm run seed:qa -- --verify             # re-assert existing data, write nothing
npm run seed:qa -- --dry-run            # print the plan, connect to nothing
npm run seed:qa -- --reset              # delete generated rows, then stop
```

Exit code is non-zero when an assertion fails, so it can gate a QA sign-off.

## Safety

This connects with superuser privileges and writes business data. Every check is
a hard refusal, never a warning (`lib/guards.ts`):

- host must be `localhost`/`127.0.0.1` **and** port must be `5433`
  (`5432` is production Postgres on the same VPS and gets a specific error)
- no connection field or environment variable may mention the Supabase cloud
- the production operator `92dc5797-…` must be absent from `public.operators` —
  a tunnel could make production look local, so this is checked against the
  connected database before any write

## Two rules that make this a test, not just data

**Never write `orders.status`.** It defaults to `ingresado` and is thereafter
owned by the trigger. Scenarios insert packages, let the trigger settle, then
assert. A mismatch is a real bug in the derivation logic — this is how the
"closing a dispatch route cancels its orders" regression is caught
(`scenarios/outcomes.ts`, case `QA-OUT-005`).

**Assert enum literals against `pg_enum` at startup.** A string comparison
against an enum fails quietly. `lib/enums.ts` refuses to run on drift, which is
exactly the check that would have caught `listo` → `listo_para_despacho`
(migration `20260324000001`) years before it bit us.

## UUID ranges

| Prefix | Owner |
|---|---|
| `00000000-0000-4000-8000-…` | `seed-qa.sql`, the spec-48 baseline |
| `00000000-0000-4000-9000-…` | this generator |

`--reset` only ever deletes the second range, so the baseline the QA runbook and
`create-qa-users.sh` depend on survives. The group code is embedded in each id,
so a row says which scenario built it.

## Layout

```
index.ts              CLI entry and orchestration
lib/guards.ts         connection refusals (unit-tested)
lib/cli.ts            argument parsing (unit-tested)
lib/ids.ts            deterministic UUID allocation (unit-tested)
lib/enums.ts          expected enum values + drift detection (unit-tested)
lib/db.ts             pg connection, transactions, enum check
lib/assert.ts         post-insert assertions
lib/factories.ts      order/package/operator row builders
scenarios/            one module per scenario group
```

`npm run test:run --workspace=@aureon/database` covers the pure logic — guards,
CLI, ids, enum comparison — without needing a database. SQL correctness is
verified by running the generator against QA.

## Adding a scenario group

1. Add a file under `scenarios/` exporting `seed<Name>(db, collector, options)`.
2. Add its group to `ScenarioGroup` in `lib/ids.ts` so its rows are identifiable.
3. Add its name to `SCENARIO_GROUPS` in `lib/cli.ts`.
4. Wire it into `runScenarios` in `index.ts`.

State the expected derived status in the scenario and assert it. A scenario that
inserts rows without asserting anything is a fixture, not a test.
