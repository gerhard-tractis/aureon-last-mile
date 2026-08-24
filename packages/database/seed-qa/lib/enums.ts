/**
 * spec-51 — enum literals, checked against the live database at startup.
 *
 * The `listo` -> `listo_para_despacho` rename (20260324000001) updated the
 * enums but not the TEXT comparisons in pipeline_position() and
 * recalculate_order_status(), which silently stopped matching. That cost us a
 * bug where closing a dispatch route cancelled its orders (fixed in
 * 20260810000001).
 *
 * A string comparison against an enum fails quietly. So before writing any
 * data, the generator asks the database what its enums actually contain and
 * refuses to run on a mismatch. Cheap, and it turns a silent divergence into a
 * loud one.
 */

/** Enum values as of migration 20260810000001. Keep sorted as the DB reports. */
export const EXPECTED_ENUMS: Record<string, readonly string[]> = {
  order_status_enum: [
    'ingresado', 'verificado', 'en_bodega', 'asignado', 'en_carga',
    'listo_para_despacho', 'en_ruta', 'entregado', 'cancelado',
    'en_retorno', 'parcialmente_entregado',
  ],
  package_status_enum: [
    'ingresado', 'verificado', 'en_bodega', 'sectorizado', 'retenido',
    'asignado', 'en_carga', 'listo_para_despacho', 'en_ruta', 'retorno_hub',
    'entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado',
  ],
  route_status_enum: ['planned', 'in_progress', 'completed', 'cancelled', 'draft'],
  dispatch_status_enum: ['pending', 'delivered', 'failed', 'partial'],
  pickup_route_status_enum: ['draft', 'in_progress', 'in_transit', 'received', 'cancelled'],
  manifest_status_enum: ['pending', 'in_progress', 'completed', 'cancelled'],
  reception_status_enum: ['awaiting_reception', 'reception_in_progress', 'received'],
  reception_scan_result_enum: ['received', 'not_found', 'duplicate', 'route_mismatch'],
  scan_result_enum: ['verified', 'not_found', 'duplicate'],
  dock_scan_result_enum: ['accepted', 'rejected', 'wrong_zone', 'unmapped'],
  batch_status_enum: ['open', 'closed'],
  intake_status_enum: [
    'received', 'parsing', 'parsed', 'needs_review', 'confirmed', 'failed', 'rejected',
  ],
  intake_method_enum: ['email', 'whatsapp', 'portal', 'api', 'manual', 'mobile_camera'],
  imported_via_enum: ['API', 'EMAIL', 'MANUAL', 'CSV', 'OCR'],
  fleet_type_enum: ['own', 'external'],
  driver_status_enum: ['active', 'inactive', 'suspended', 'terminated'],
  user_role: [
    // pickup_leader: added by migration 20260820000001 (spec-61). Every
    // pre-existing pickup_crew account was promoted to it by 20260820000002,
    // so QA can hold either.
    // ops_leader: added by 20260824000001 (spec-66). No account is migrated
    // onto it; it is assigned per user through /admin.
    'pickup_crew', 'pickup_leader', 'ops_leader', 'warehouse_staff',
    'loading_crew', 'operations_manager', 'admin', 'super_admin',
  ],
};

export interface EnumDrift {
  enumName: string;
  missingInDb: string[];
  unexpectedInDb: string[];
}

/**
 * Compare what we expect against what the database reports.
 * `actual` maps enum name -> values, as returned by queryEnums().
 *
 * Enums present in the database but absent from EXPECTED_ENUMS are ignored —
 * this list is deliberately partial, covering only what the scenarios write.
 */
export function findEnumDrift(actual: Record<string, string[]>): EnumDrift[] {
  const drift: EnumDrift[] = [];

  for (const [enumName, expected] of Object.entries(EXPECTED_ENUMS)) {
    const actualValues = actual[enumName];

    // A driver that returns Postgres arrays as raw strings would otherwise fail
    // here with a cryptic "filter is not a function". Say what actually broke.
    if (actualValues !== undefined && !Array.isArray(actualValues)) {
      throw new TypeError(
        `Enum "${enumName}" came back as ${typeof actualValues}, not an array: ` +
          `${JSON.stringify(actualValues)}. The driver did not parse the Postgres ` +
          `array — check that ENUM_QUERY still casts enumlabel to text.`,
      );
    }

    if (!actualValues) {
      drift.push({
        enumName,
        missingInDb: [...expected],
        unexpectedInDb: [],
      });
      continue;
    }

    const actualSet = new Set(actualValues);
    const expectedSet = new Set(expected);

    const missingInDb = expected.filter((v) => !actualSet.has(v));
    const unexpectedInDb = actualValues.filter((v) => !expectedSet.has(v));

    if (missingInDb.length > 0 || unexpectedInDb.length > 0) {
      drift.push({ enumName, missingInDb, unexpectedInDb });
    }
  }

  return drift;
}

/** Human-readable drift report for the CLI. */
export function formatEnumDrift(drift: EnumDrift[]): string {
  const lines = ['Enum drift between this generator and the database:', ''];

  for (const { enumName, missingInDb, unexpectedInDb } of drift) {
    lines.push(`  ${enumName}`);
    if (missingInDb.length > 0) {
      lines.push(`    expected but absent from the DB: ${missingInDb.join(', ')}`);
    }
    if (unexpectedInDb.length > 0) {
      lines.push(`    present in the DB but not expected here: ${unexpectedInDb.join(', ')}`);
    }
  }

  lines.push(
    '',
    'Either a migration changed an enum and seed-qa/lib/enums.ts was not updated,',
    'or the QA database is behind the repo. Replay migrations with',
    'infra/supabase-qa/apply-migrations.sh, then update EXPECTED_ENUMS if the',
    'change is intentional.',
  );

  return lines.join('\n');
}

/**
 * SQL to read every enum and its values.
 *
 * The `::text` cast is load-bearing. `pg_enum.enumlabel` is of type `name`, so
 * `array_agg(e.enumlabel)` yields `name[]` (OID 1003) — and node-pg ships no
 * parser for that OID, handing back the raw literal `{open,closed}` as a string
 * instead of an array. Casting to text produces `text[]` (OID 1009), which
 * node-pg parses into a JS array. Without it, findEnumDrift() fails with
 * "actualValues.filter is not a function".
 */
export const ENUM_QUERY = `
  SELECT t.typname AS enum_name,
         array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
`;
