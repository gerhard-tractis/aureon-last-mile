/**
 * spec-51 — deterministic UUID allocation for QA scenario data.
 *
 * Two separate ranges live in the QA database:
 *
 *   00000000-0000-4000-8000-...   seed-qa.sql (spec-48 baseline)
 *   00000000-0000-4000-9000-...   this generator
 *
 * Both are valid UUID v4 (version nibble 4, variant nibble 8 or 9), obviously
 * fake, and greppable. Keeping them apart is what lets `--reset` delete
 * everything this generator made without touching the spec-48 baseline the
 * QA runbook and create-qa-users.sh depend on.
 *
 * Determinism matters: re-running the generator must produce the same ids so
 * inserts stay idempotent under ON CONFLICT DO NOTHING, and so the test scope
 * doc can name a specific order.
 */

/** Shared by every row this generator creates. Used by --reset. */
export const GENERATED_NODE = '9000';
export const GENERATED_PREFIX = `00000000-0000-4000-${GENERATED_NODE}-`;

/** SQL pattern for --reset. Matches only rows this generator created. */
export const GENERATED_LIKE_PATTERN = `${GENERATED_PREFIX}%`;

/**
 * Scenario groups. The code becomes the high 4 hex digits of the node-3
 * segment, so every row's id says which scenario built it — worth the
 * indirection when debugging a QA database by eye.
 */
export enum ScenarioGroup {
  INFRASTRUCTURE = 0x0001,
  INGESTION = 0x0010,
  PICKUP = 0x0020,
  RECEPTION = 0x0030,
  DISTRIBUTION = 0x0040,
  DISPATCH = 0x0050,
  OUTCOMES = 0x0060,
  RETURNS = 0x0070,
  COMMS = 0x0080,
  TENANCY = 0x0090,
  DATA_QUALITY = 0x00a0,
  /** Exhaustive package-status combination matrix. */
  MATRIX = 0x00b0,
  /** Orders driven through real RPC transitions. */
  JOURNEYS = 0x00c0,
}

const MAX_SEQUENCE = 0xffffffff;

/**
 * Build a stable id for a row.
 *
 * @param group    which scenario group owns the row
 * @param sequence per-group counter, unique within the group
 */
export function qaId(group: ScenarioGroup, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
    throw new RangeError(
      `sequence must be an integer in [0, ${MAX_SEQUENCE}], got ${sequence}`,
    );
  }

  const groupHex = group.toString(16).padStart(4, '0');
  const seqHex = sequence.toString(16).padStart(8, '0');
  return `${GENERATED_PREFIX}${groupHex}${seqHex}`;
}

/** True if the id was produced by this generator (i.e. --reset should remove it). */
export function isGeneratedId(id: string): boolean {
  return id.toLowerCase().startsWith(GENERATED_PREFIX);
}

/**
 * Fixed ids that scenarios reference by name rather than by sequence.
 * The second operator is the one that makes cross-tenant isolation testable —
 * the spec-48 baseline seeds only one.
 */
export const FIXED_IDS = {
  /** spec-48 baseline operator. Owned by seed-qa.sql, never written here. */
  BASELINE_OPERATOR: '00000000-0000-4000-8000-000000000001',
  /** Second operator, for cross-tenant isolation tests. */
  SECOND_OPERATOR: qaId(ScenarioGroup.TENANCY, 2),
  /** Operator with no modules enabled, for the Phase 0 exit criterion. */
  BLANK_OPERATOR: qaId(ScenarioGroup.TENANCY, 3),
} as const;
