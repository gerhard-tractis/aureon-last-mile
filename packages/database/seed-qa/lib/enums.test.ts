import { describe, it, expect } from 'vitest';
import { findEnumDrift, formatEnumDrift, EXPECTED_ENUMS } from './enums';

/** A database that matches EXPECTED_ENUMS exactly. */
function matchingDb(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(EXPECTED_ENUMS).map(([name, values]) => [name, [...values]]),
  );
}

describe('findEnumDrift', () => {
  it('reports nothing when the database matches', () => {
    expect(findEnumDrift(matchingDb())).toEqual([]);
  });

  it('ignores extra enums the generator does not write to', () => {
    const db = matchingDb();
    db.some_unrelated_enum = ['a', 'b'];
    expect(findEnumDrift(db)).toEqual([]);
  });

  it('ignores value ordering', () => {
    const db = matchingDb();
    db.batch_status_enum = ['closed', 'open'];
    expect(findEnumDrift(db)).toEqual([]);
  });

  // The exact scenario that caused the dispatch-cancels-orders bug: the DB
  // renamed a value and the TypeScript literal kept the old one.
  it('catches a renamed enum value in both directions', () => {
    const db = matchingDb();
    db.order_status_enum = db.order_status_enum.map((v) =>
      v === 'listo_para_despacho' ? 'listo' : v,
    );

    const drift = findEnumDrift(db);
    expect(drift).toHaveLength(1);
    expect(drift[0].enumName).toBe('order_status_enum');
    expect(drift[0].missingInDb).toEqual(['listo_para_despacho']);
    expect(drift[0].unexpectedInDb).toEqual(['listo']);
  });

  it('catches a value added by a migration we do not know about', () => {
    const db = matchingDb();
    db.route_status_enum = [...db.route_status_enum, 'archived'];

    const drift = findEnumDrift(db);
    expect(drift).toHaveLength(1);
    expect(drift[0].unexpectedInDb).toEqual(['archived']);
    expect(drift[0].missingInDb).toEqual([]);
  });

  it('catches a value we expect that the DB lacks', () => {
    const db = matchingDb();
    db.package_status_enum = db.package_status_enum.filter((v) => v !== 'retenido');

    const drift = findEnumDrift(db);
    expect(drift[0].missingInDb).toEqual(['retenido']);
  });

  // If the QA database is behind the repo, an enum may not exist at all.
  it('reports an enum missing from the database entirely', () => {
    const db = matchingDb();
    delete db.pickup_route_status_enum;

    const drift = findEnumDrift(db);
    expect(drift).toHaveLength(1);
    expect(drift[0].enumName).toBe('pickup_route_status_enum');
    expect(drift[0].missingInDb.length).toBeGreaterThan(0);
  });

  it('reports every drifting enum, not just the first', () => {
    const db = matchingDb();
    db.batch_status_enum = ['open'];
    db.fleet_type_enum = ['own'];

    expect(findEnumDrift(db)).toHaveLength(2);
  });
});

describe('formatEnumDrift', () => {
  it('names the enum and both directions of the difference', () => {
    const message = formatEnumDrift([
      { enumName: 'order_status_enum', missingInDb: ['listo_para_despacho'], unexpectedInDb: ['listo'] },
    ]);

    expect(message).toContain('order_status_enum');
    expect(message).toContain('listo_para_despacho');
    expect(message).toContain('listo');
    expect(message).toContain('apply-migrations.sh');
  });

  it('omits an empty direction', () => {
    const message = formatEnumDrift([
      { enumName: 'route_status_enum', missingInDb: [], unexpectedInDb: ['archived'] },
    ]);

    expect(message).not.toContain('expected but absent');
    expect(message).toContain('present in the DB but not expected');
  });
});

describe('EXPECTED_ENUMS', () => {
  // Guards against copy-paste when adding an enum.
  it('has no duplicate values within an enum', () => {
    for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
      expect(new Set(values).size, `${name} has duplicates`).toBe(values.length);
    }
  });

  it('carries the post-rename literal, never the pre-rename one', () => {
    expect(EXPECTED_ENUMS.order_status_enum).toContain('listo_para_despacho');
    expect(EXPECTED_ENUMS.order_status_enum).not.toContain('listo');
    expect(EXPECTED_ENUMS.package_status_enum).toContain('listo_para_despacho');
    expect(EXPECTED_ENUMS.package_status_enum).not.toContain('listo');
  });
});
